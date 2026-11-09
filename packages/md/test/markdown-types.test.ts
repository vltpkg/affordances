import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, expectTypeOf, test, vi } from 'vitest'
import {
  type Config,
  type Markdown,
  type MarkdownArgs,
  md,
  type RouteParams,
  type Slots,
} from '../src/next/index.ts'

test("MarkdownArgs<'/route'> gives params their types from the route, as page.tsx's PageProps does", () => {
  expectTypeOf<RouteParams<'/blog/[slug]'>>().toEqualTypeOf<{ slug: string }>()
  expectTypeOf<
    RouteParams<'/registry/[registry]/package/[pkg]/version/[version]'>
  >().toEqualTypeOf<{
    registry: string
    pkg: string
    version: string
  }>()
  expectTypeOf<RouteParams<'/docs/[...slug]'>>().toEqualTypeOf<{ slug: string[] }>()
  expectTypeOf<RouteParams<'/docs/[[...slug]]'>>().toEqualTypeOf<{ slug?: string[] }>()
  expectTypeOf<RouteParams<'/team/[member-id]'>>().toEqualTypeOf<{ 'member-id': string }>()
  expectTypeOf<RouteParams<'/about'>>().toEqualTypeOf<{}>()
  // without a route, as in 0.2.0
  expectTypeOf<MarkdownArgs['params']>().toEqualTypeOf<Record<string, string | string[]>>()
  // a 0.2.0 markdown.ts, typed with plain MarkdownArgs, still fits its route
  expectTypeOf<(args: MarkdownArgs) => string>().toExtend<Markdown<'/docs/[[...slug]]'>>()
  // satisfies gives each fill its params through contextual typing: no annotations, no casts
  const slots = {
    readme: async ({ params }) => `# ${decodeURIComponent(params.pkg)}`,
  } satisfies Slots<'/package/[pkg]'>
  expectTypeOf(slots.readme).parameter(0).toEqualTypeOf<MarkdownArgs<'/package/[pkg]'>>()
})

// a real tsc run over an app's markdown.ts and the .affordances/md.ts md() generates for it
const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url))
const src = fileURLToPath(new URL('../src/next/', import.meta.url))
let root: string
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
const check = (markdown: string) => {
  root = mkdtempSync(join(tmpdir(), 'md-types-'))
  const files = {
    'app/package/[pkg]/page.tsx': 'export default function Page() { return null }\n',
    'app/package/[pkg]/markdown.ts': markdown,
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2023',
        lib: ['es2023', 'dom'],
        jsx: 'preserve',
        allowImportingTsExtensions: true,
        typeRoots: [fileURLToPath(new URL('../../../node_modules/@types', import.meta.url))],
        types: ['node'],
        paths: {
          '@affordances/md/next': [join(src, 'index.ts')],
          '@affordances/md/routes': [join(src, 'markdown-routes.ts')],
        },
      },
      include: ['**/*.ts', '.affordances/**/*.ts'],
    }),
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  md({ root })({})
  try {
    execFileSync(process.execPath, [tsc, '-p', root, '--pretty', 'false'], {
      encoding: 'utf8',
      cwd: root,
    })
    return ''
  } catch (error) {
    return String((error as { stdout: string }).stdout)
  }
}

test('the generated .affordances/md.ts fails tsc when a markdown.ts is typed for another route', () => {
  const good = `import type { MarkdownArgs, Slots } from '@affordances/md/next'

export default async function markdown({ params }: MarkdownArgs<'/package/[pkg]'>) {
  return \`# \${decodeURIComponent(params.pkg)}\`
}

export const slots = {
  readme: async ({ params }) => \`readme of \${params.pkg}\`,
} satisfies Slots<'/package/[pkg]'>
`
  expect(check(good)).toBe('')
  // the default export, typed for another route
  expect(
    check(
      good
        .replace("MarkdownArgs<'/package/[pkg]'>", "MarkdownArgs<'/package/[name]'>")
        .replace('params.pkg)', 'params.name)'),
    ),
  ).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
  // the slots, typed for another route
  expect(
    check(
      good
        .replace("Slots<'/package/[pkg]'>", "Slots<'/package/[name]'>")
        .replace('readme of ${params.pkg}', 'readme of ${params.name}'),
    ),
  ).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
  // a route string with the same params but a typo, or fewer params (a copy from a sibling route): the route literal
  // differs, so it fails too, naming both routes
  const realRoute = /Type '"\/package\/\[pkg\]"' is not assignable to type '"\/packages\/\[pkg\]"'/
  for (const typo of [
    good.replace("MarkdownArgs<'/package/[pkg]'>", "MarkdownArgs<'/packages/[pkg]'>"),
    good.replace("Slots<'/package/[pkg]'>", "Slots<'/packages/[pkg]'>"),
  ]) {
    const out = check(typo)
    expect(out).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
    expect(out).toMatch(realRoute)
  }
  const fewer = check(
    good
      .replace("Slots<'/package/[pkg]'>", "Slots<'/package'>")
      .replace('readme of ${params.pkg}', 'readme'),
  )
  expect(fewer).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
  expect(fewer).toMatch(/Type '"\/package\/\[pkg\]"' is not assignable to type '"\/package"'/)
  // a param the route doesn't have is an error in markdown.ts itself, where it's written
  expect(check(good.replace('readme of ${params.pkg}', 'readme of ${params.name}'))).toMatch(
    /^app\/package\/\[pkg\]\/markdown\.ts\(\d+,\d+\): error TS2339: Property 'name' does not exist/m,
  )
})

// what md() says when it can't add the entry itself
const told = (why: string) =>
  `[affordances-md] tsconfig.json ${why}, so tsc can't check each markdown.ts against its route. Add ".affordances/**/*.ts" to its "include".`

test("md() adds .affordances/ to tsconfig.json's include, as next adds .next/types, keeping its comments and format", () => {
  check("export default () => '# x'\n")
  const tsconfig = join(root, 'tsconfig.json')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const load = (text: string) => {
    writeFileSync(tsconfig, text)
    log.mockClear()
    warn.mockClear()
    md({ root })({})
    return {
      text: readFileSync(tsconfig, 'utf8'),
      logged: log.mock.calls.map(([message]) => String(message)),
      warned: warn.mock.calls.map(([message]) => String(message)),
    }
  }
  const added = `[affordances-md] added ".affordances/**/*.ts" to tsconfig.json's "include", so tsc checks each markdown.ts against its route`

  // a commented file, one entry per line, a comment after the last: only a line is added
  const commented = `{
  // next's own
  "compilerOptions": { "strict": true, /* keep */ "paths": { "@/*": ["./src/*"] } },
  "include": [
    "next-env.d.ts",
    "**/*.ts", // pages
    "**/*.tsx" // components
  ],
  "exclude": ["node_modules"]
}
`
  expect(load(commented)).toEqual({
    text: commented.replace(
      '    "**/*.tsx" // components\n',
      '    "**/*.tsx", // components\n    ".affordances/**/*.ts"\n',
    ),
    logged: [added],
    warned: [],
  })
  // a trailing comma stays a trailing comma; one line stays one line
  expect(load('{ "include": [\n  "a.ts",\n] }\n').text).toBe(
    '{ "include": [\n  "a.ts",\n  ".affordances/**/*.ts",\n] }\n',
  )
  expect(load('{"include":["next-env.d.ts","**/*.ts"]}').text).toBe(
    '{"include":["next-env.d.ts","**/*.ts", ".affordances/**/*.ts"]}',
  )
  // already there: no write, nothing said
  const present = '{ "include": ["**/*.ts", ".affordances/**/*.ts"] }\n'
  expect(load(present)).toEqual({ text: present, logged: [], warned: [] })
  // can't be read, or include is inherited: left as it is, with the line to add
  const broken = '{ "include": ["**/*.ts", }}'
  expect(load(broken)).toEqual({ text: broken, logged: [], warned: [told("couldn't be read")] })
  const inherited = '{ "extends": "../../tsconfig.base.json" }\n'
  expect(load(inherited)).toEqual({
    text: inherited,
    logged: [],
    warned: [told('has no "include" of its own to add .affordances/ to')],
  })
  log.mockRestore()
  warn.mockRestore()
})

// a read-only tree (a sandbox, a checkout owned by another user, a read-only image layer): md() still loads. root can
// write anything, so there the case can't be made
test.skipIf(process.getuid?.() === 0)(
  "md() never throws on a read-only tree: it warns, and leaves what it can't write alone",
  () => {
    check("export default () => '# x'\n")
    const tsconfig = join(root, 'tsconfig.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const text = '{ "include": ["**/*.ts"] }\n'
      writeFileSync(tsconfig, text)
      chmodSync(tsconfig, 0o444)
      expect(() => md({ root })({})).not.toThrow()
      expect(readFileSync(tsconfig, 'utf8')).toBe(text)
      expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
        told("couldn't be written (EACCES)"),
      ])
      expect(log).not.toHaveBeenCalled()

      // .affordances/ itself read-only, with an md.ts from an earlier build: that one is used
      const generated = join(root, '.affordances', 'md.ts')
      writeFileSync(generated, 'export const routes = {}\n')
      chmodSync(join(root, '.affordances'), 0o555)
      chmodSync(generated, 0o444)
      warn.mockClear()
      const config: Config = md({ root })({})
      expect(config.turbopack?.resolveAlias).toEqual({
        '@affordances/md/routes': './.affordances/md.ts',
      })
      expect(String(warn.mock.calls[0]?.[0])).toBe(
        "[affordances-md] couldn't write .affordances/md.ts (EACCES), so the one already there is used, and a markdown.ts added or removed since it was written is missed. Make .affordances/ writable for next dev and next build.",
      )
      // without one, no alias: pages convert from their html, and the config still loads
      chmodSync(join(root, '.affordances'), 0o755)
      rmSync(generated, { force: true })
      chmodSync(join(root, '.affordances'), 0o555)
      warn.mockClear()
      const bare: Config = md({ root })({})
      expect(bare.turbopack).toBeUndefined()
      expect(String(warn.mock.calls[0]?.[0])).toBe(
        "[affordances-md] couldn't write .affordances/md.ts (EACCES), so no markdown.ts runs and pages are converted from their HTML. Make .affordances/ writable for next dev and next build.",
      )
    } finally {
      chmodSync(join(root, '.affordances'), 0o755)
      chmodSync(tsconfig, 0o644)
      warn.mockRestore()
      log.mockRestore()
    }
  },
)

// a markdown.ts, as a 0.2.0 unit test calls it
const byHand = ({ params }: MarkdownArgs<'/package/[pkg]'>) => `# ${params.pkg}`

test("A18: route is optional in MarkdownArgs, so arguments built by hand, as 0.2.0's were, still type-check", () => {
  const args: MarkdownArgs<'/package/[pkg]'> = {
    params: { pkg: 'express' },
    searchParams: new URLSearchParams(),
    request: new Request('https://shop.test/package/express'),
  }
  expectTypeOf(args.route).toEqualTypeOf<'/package/[pkg]' | undefined>()
  // a 0.2.0 unit test calling its markdown.ts directly
  expect(byHand(args)).toBe('# express')
})

test("a markdown.ts that isn't one fails tsc with what to do, naming the file, never a TS2322 in md.ts", () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const message =
    "app/package/[pkg]/markdown.ts has none of the exports a markdown.ts next to a page uses (default, slots): it exports methodology, steps. So it's left out, and /package/[pkg] converts from its HTML. If it isn't for @affordances/md, move it out of app/ or rename it."
  const out = check(
    "export const methodology = { steps: 3 }\nconst steps = ['a']\nexport { steps }\nexport type Step = string\n",
  )
  expect(out).not.toMatch(/TS2322/)
  expect(out.replace(/^\.affordances\/md\.ts\(\d+,\d+\)/, '.affordances/md.ts')).toContain(
    `.affordances/md.ts: error TS2344: Type '${JSON.stringify(message)}' does not satisfy the constraint 'never'.`,
  )
  expect(out.trim().split('\n')).toHaveLength(1)
  expect(error).toHaveBeenCalledWith(`[affordances-md] ${message}`)
  // and the handler never imports it
  expect(readFileSync(join(root, '.affordances/md.ts'), 'utf8')).not.toContain('import(')
  error.mockRestore()
})
