import { createRequire } from 'node:module'
import { chromium, type Request } from 'playwright'

// the browser a trial's browser surface and its WebMCP bridge each drive: headless Chromium with the surface's own
// flags, recorded, and a context holding only the trial's session cookie, confined to the trial's origin

/**
 * Chromium launched with `launchArgs` and a context carrying the trial's session. Its versions and flags are recorded
 * with the trial, since they're the same across trials, as the preflight checks.
 */
export const trialBrowser = async (
  config: { url: string; session: string },
  launchArgs: string[],
) => {
  const origin = new URL(config.url).origin
  const browser = await chromium.launch({ headless: true, args: launchArgs })
  const versions = {
    chromium: browser.version(),
    playwright: (createRequire(import.meta.url)('playwright/package.json') as { version: string })
      .version,
    launchArgs,
  }
  const context = await browser.newContext()
  await context.addCookies([
    { name: 'sid', value: config.session, url: config.url, httpOnly: true, sameSite: 'Lax' },
  ])
  /** Confines the context to the trial's origin: any request elsewhere is aborted, after `aborted` is told of it. */
  const confine = (aborted: (url: string, request: Request) => void) =>
    context.route('**/*', async (route) => {
      const url = route.request().url()
      if (new URL(url).origin === origin) return route.continue()
      aborted(url, route.request())
      return route.abort('blockedbyclient')
    })
  return { origin, browser, context, versions, confine }
}
