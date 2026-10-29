import { expect, test, type Page } from '@playwright/test'

const MEDIA_TYPE = 'application/vnd.affordances+json'

const cart = (page: Page) => page.getByRole('banner').getByRole('link', { name: /^Cart/ })

test('a person adds to cart, changes quantity, and checks out', async ({ page }) => {
  await page.goto('/products/six-panel-cap')
  await page.getByText('Black', { exact: true }).click()
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(cart(page)).toHaveText(/1$/)

  await cart(page).click()
  await page.getByRole('button', { name: 'One more Six-Panel Cap' }).click()
  await expect(page.locator('output')).toHaveText('2')

  await page.getByRole('link', { name: 'Check out' }).click()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/account\/orders$/)
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Six-Panel Cap' }).first(),
  ).toContainText('2 ×')
  await expect(cart(page)).toHaveText(/Cart$/)
})

test('an agent shops headless through the graph', async ({ request, baseURL }) => {
  const read = (path: string) => request.get(path, { headers: { accept: MEDIA_TYPE } })
  // cookie-authenticated calls need an Origin that matches the site
  const call = (path: string, body: object) =>
    request.post(path, {
      headers: { 'content-type': MEDIA_TYPE, origin: baseURL! },
      data: JSON.stringify(body),
    })

  const graph = await (await read('/products/sticker-sheet')).json()
  expect(graph.route).toBe('/products/[slug]')
  expect(graph.actions).toContainEqual(
    expect.objectContaining({ name: 'addToCart', available: true }),
  )

  const added = await call('/products/sticker-sheet', {
    action: 'addToCart',
    input: { sku: 'STK-01' },
  })
  expect(added.ok()).toBe(true)
  expect((await added.json()).changed.cart).toEqual({ count: 1 })

  const unconfirmed = await call('/checkout', { action: 'placeOrder', input: {} })
  expect(unconfirmed.status()).toBe(409)
  const pending = await unconfirmed.json()
  expect(pending.error.code).toBe('confirm_required')
  expect(pending.error.message).toContain('1 item totalling $8.00')

  const placed = await (
    await call('/checkout', { action: 'placeOrder', input: {}, confirm: true })
  ).json()
  expect(placed).toMatchObject({ ok: true, redirect: '/account/orders' })

  const orders = await (await read(placed.redirect)).json()
  expect(orders.entities.orders[0].items).toEqual([
    { name: 'Sticker Sheet', variant: null, quantity: 1 },
  ])
})

test('the agent view shows the live graph at the same url', async ({ page }) => {
  await page.goto('/products/heavyweight-tee')
  const toggle = page.getByRole('button', { name: 'Agent view' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(toggle).toBeFocused()
  const view = page.getByRole('region', { name: 'Agent view' })
  await expect(view).toContainText('GET /products/heavyweight-tee')
  await expect(view).toContainText('"route": "/products/[slug]"')
  await expect(page.getByRole('heading', { name: 'Heavyweight Tee' })).toBeHidden()

  // it survives navigation
  await page.getByRole('banner').getByRole('link', { name: 'Account' }).click()
  await expect(view).toContainText('"route": "/account/orders"')

  await toggle.click()
  await expect(view).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible()
})

test('WebMCP tools add to cart and place an order with the person’s approval', async ({ page }) => {
  // a stand-in for the browser's WebMCP: record each registered tool on window
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute: (input: unknown, options: object) => Promise<string> }
    >()
    Object.assign(window, { recordedTools: tools })
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (
          tool: { name: string; execute: (input: unknown, options: object) => Promise<string> },
          { signal }: { signal?: AbortSignal } = {},
        ) => {
          tools.set(tool.name, tool)
          signal?.addEventListener('abort', () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name)
          })
        },
      },
    })
  })
  type Tools = Map<string, { execute: (input: unknown, options: object) => Promise<string> }>
  const tools = () =>
    page.evaluate(() => [...(window as unknown as { recordedTools: Tools }).recordedTools.keys()])
  const run = (name: string, input: unknown) =>
    page.evaluate(
      ([tool, args]) =>
        (window as unknown as { recordedTools: Tools }).recordedTools
          .get(tool as string)!
          .execute(args, {}),
      [name, input] as const,
    )

  await page.goto('/products/dot-grid-notebook')
  await expect.poll(tools).toContain('addToCart')
  const added = JSON.parse(await run('addToCart', { sku: 'NBK-A5' }))
  expect(added.ok).toBe(true)
  await expect(cart(page)).toHaveText(/1$/)

  await page.goto('/checkout')
  await expect.poll(tools).toContain('placeOrder')
  const placing = run('placeOrder', {})
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Place an order for 1 item totalling $22.00')
  await dialog.getByRole('button', { name: 'Place order' }).click()
  expect(JSON.parse(await placing)).toMatchObject({ ok: true, redirect: '/account/orders' })
  await expect(page).toHaveURL(/\/account\/orders$/)
  await expect(page.locator('ol').getByText('Dot Grid Notebook')).toBeVisible()
  await expect(cart(page)).toHaveText(/Cart$/)
})

test('every page reads as markdown: .md urls and Accept: text/markdown', async ({ request }) => {
  const viaSuffix = await request.get('/products/heavyweight-tee.md')
  expect(viaSuffix.headers()['content-type']).toBe('text/markdown; charset=utf-8')
  const markdown = await viaSuffix.text()
  expect(markdown).toContain('# Heavyweight Tee')
  // streamed (Suspense) content is in, the agent-only SKU list is clean, and the site chrome is out
  expect(markdown).toContain('Size: S (selected), M, L (unavailable), XL')
  expect(markdown).toContain('**SKU**: TEE-BLK-S, TEE-BLK-M, TEE-BLK-L, TEE-BLK-XL')
  expect(markdown).not.toContain('A demo store: nothing ships')
  expect(markdown).not.toContain('$ACTION_ID')

  const viaAccept = await request.get('/products/heavyweight-tee', {
    headers: { accept: 'text/markdown' },
  })
  expect(await viaAccept.text()).toBe(markdown)
  expect((await request.get('/index.md')).status()).toBe(200)
  // the graph is still there at the same url
  const graph = await request.get('/products/heavyweight-tee', {
    headers: { accept: 'application/vnd.affordances+json' },
  })
  expect((await graph.json()).route).toBe('/products/[slug]')
})
