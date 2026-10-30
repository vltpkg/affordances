// checks a running build of the docs: every sitemap page's markdown twin, the links in llms.txt, and the
// redirects from old urls. usage: node scripts/check-md.mjs http://localhost:3117
const base = process.argv[2] ?? 'http://localhost:3000'
const failures = []
const fail = (why) => failures.push(why)

// chrome that must never reach markdown: header, sidebar, toc, page actions, controls, other package
// managers' commands
const banned = [
  'Search documentation',
  'Main navigation',
  'On this page',
  'Edit this page',
  'Copy page',
  'Copy Page',
  'Copy code',
  'Package manager',
  'Make your app agent-operable',
  'back to top',
  'words selected',
  'Toggle Sidebar',
  'Open menu',
  'Show more',
  'npx ',
  'npm install',
  'pnpm dlx',
  'pnpm add',
  'yarn dlx',
  'yarn add',
  'bunx ',
  'bun add',
  'deno run',
  'deno add',
]

const sitemap = await (await fetch(`${base}/sitemap.xml`)).text()
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)

for (const path of paths) {
  const html = await (await fetch(base + path)).text()
  const title = (html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()
  for (const [how, res] of [
    ['.md', await fetch(base + (path === '/' ? '/index.md' : `${path}.md`))],
    ['accept', await fetch(base + path, { headers: { accept: 'text/markdown' } })],
  ]) {
    const md = await res.text()
    const where = `${path} (${how})`
    if (res.status !== 200) fail(`${where}: status ${res.status}`)
    if (!md.startsWith('---\n')) fail(`${where}: no frontmatter`)
    const h1 = md.match(/^# (.+)$/m)?.[1]
    if (h1 !== title) fail(`${where}: h1 "${h1}" vs page "${title}"`)
    for (const b of banned) if (md.includes(b)) fail(`${where}: contains "${b}"`)
    // every opening fence names its language
    let open = null
    for (const line of md.split('\n')) {
      const m = line.match(/^(`{3,})(.*)$/)
      if (!m) continue
      if (open) {
        if (m[1].length >= open.length && !m[2].trim()) open = null
        continue
      }
      open = m[1]
      if (!m[2].trim()) fail(`${where}: fence without a language`)
    }
  }
}

// every link in llms.txt resolves
const llms = await (await fetch(`${base}/llms.txt`)).text()
const links = [...llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]).pathname)
for (const link of links) {
  const res = await fetch(base + link)
  if (res.status !== 200) fail(`llms.txt: ${link} is ${res.status}`)
}

// old urls go straight (one 308) to where the page lives now
const redirects = [
  ['/why', '/docs'],
  ['/why.md', '/docs.md'],
  ['/quickstart', '/docs/quickstart'],
  ['/markdown', '/docs/plugins/md'],
  ['/markdown.md', '/docs/plugins/md.md'],
  ['/concepts/actions.md', '/docs/concepts/actions.md'],
  ['/nextjs', '/docs/guides/nextjs'],
  ['/docs/nextjs', '/docs/guides/nextjs'],
  ['/docs/mcp.md', '/docs/guides/mcp.md'],
  ['/docs/guides/md/setup', '/docs/plugins/md/setup'],
  ['/docs/md', '/docs/plugins/md'],
  ['/docs/md/setup', '/docs/plugins/md/setup'],
  ['/docs/md/setup.md', '/docs/plugins/md/setup.md'],
  ['/docs/guides/bench', '/docs/benchmarks'],
  ['/docs/guides/bench.md', '/docs/benchmarks.md'],
  ['/bench', '/docs/benchmarks'],
  ['/docs/protocol', '/docs/reference/protocol'],
  ['/docs/options.md', '/docs/reference/options.md'],
  ['/docs/api-reference/next', '/docs/reference/api-reference/next'],
  ['/api-reference/core', '/docs/reference/api-reference/core'],
]
for (const [from, to] of redirects) {
  const res = await fetch(base + from, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (res.status !== 308 || location !== to) fail(`redirect ${from}: ${res.status} → ${location}`)
  else if ((await fetch(base + to)).status !== 200) fail(`redirect ${from}: ${to} isn't 200`)
}

console.log(
  `${paths.length} pages (markdown twice each), ${links.length} llms.txt links, ${redirects.length} redirects`,
)
console.log(failures.length ? failures.join('\n') : 'all clean')
process.exitCode = failures.length ? 1 : 0
