import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import { includesGenerated, withGenerated } from '../src/next/routes.ts'

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
// each runs tsc, a second or more on its own and more under a full run's load: past vitest's 5s default
const TSC = 30_000
const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url))
const src = fileURLToPath(new URL('../src/next/', import.meta.url))
let root: string
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
const check = (markdown: string, config: Config = {}) => {
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
          'next/navigation': [
            fileURLToPath(new URL('../node_modules/next/navigation.d.ts', import.meta.url)),
          ],
        },
      },
      include: ['**/*.ts', '.affordances/**/*.ts'],
    }),
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  md({ root })(config)
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

test(
  'the generated .affordances/md.ts fails tsc when a markdown.ts is typed for another route',
  () => {
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
    const realRoute =
      /Type '"\/package\/\[pkg\]"' is not assignable to type '"\/packages\/\[pkg\]"'/
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
  },
  TSC,
)

test(
  "notFoundMarkdown next to Next's own notFound: both are typed by the route, and neither clashes",
  () => {
    const both = `import type { MarkdownArgs, NotFoundMarkdown } from '@affordances/md/next'
import { notFound } from 'next/navigation'

export default async function markdown({ params }: MarkdownArgs<'/package/[pkg]'>) {
  if (params.pkg === 'secret') notFound()
  return undefined
}

export const notFoundMarkdown: NotFoundMarkdown<'/package/[pkg]'> = ({ params }) =>
  \`# No package \${decodeURIComponent(params.pkg)}\`
`
    expect(check(both)).toBe('')
    // typed for another route, it fails in the generated check, as the default export does
    expect(
      check(
        both.replace("NotFoundMarkdown<'/package/[pkg]'>", "NotFoundMarkdown<'/packages/[pkg]'>"),
      ),
    ).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
  },
  TSC,
)

// what md() says when tsconfig.json doesn't include .affordances/: the line, never an edit
const told = `[affordances-md] To have tsc check each markdown.ts against its route, add ".affordances/**/*.ts" to "include" in tsconfig.json, or run \`affordances-md init\`, which adds it. md() doesn't edit tsconfig.json.`

test(
  "md() never edits tsconfig.json: it says the line once; init's edit keeps the file's comments and format",
  () => {
    check("export default () => '# x'\n")
    const tsconfig = join(root, 'tsconfig.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
    writeFileSync(tsconfig, commented)
    md({ root })({})
    md({ root })({})
    expect(readFileSync(tsconfig, 'utf8')).toBe(commented)
    // once per process, however often next dev reloads the config
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([told])
    warn.mockRestore()
    // init's edit: a commented file, one entry per line, a comment after the last: only a line is added
    expect(withGenerated(commented)).toEqual({
      text: commented.replace(
        '    "**/*.tsx" // components\n',
        '    "**/*.tsx", // components\n    ".affordances/**/*.ts"\n',
      ),
    })
    // a trailing comma stays a trailing comma; one line stays one line
    expect(withGenerated('{ "include": [\n  "a.ts",\n] }\n')).toEqual({
      text: '{ "include": [\n  "a.ts",\n  ".affordances/**/*.ts",\n] }\n',
    })
    expect(withGenerated('{"include":["next-env.d.ts","**/*.ts"]}')).toEqual({
      text: '{"include":["next-env.d.ts","**/*.ts", ".affordances/**/*.ts"]}',
    })
    // can't be read, or include is inherited: left as it is, with why
    expect(withGenerated('{ "include": ["**/*.ts", }}')).toEqual({ why: "couldn't be read" })
    expect(withGenerated('{ "extends": "../../tsconfig.base.json" }\n')).toEqual({
      why: 'has no "include" of its own to add .affordances/ to',
    })
    expect(includesGenerated('{ "include": ["**/*.ts", ".affordances/**/*.ts"] }')).toBe(true)
  },
  TSC,
)

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
      expect(warn.mock.calls.map(([message]) => String(message))).toEqual([told])
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
  TSC,
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

test(
  "a markdown.ts that isn't one fails tsc with what to do, naming the file, never a TS2322 in md.ts",
  () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const message =
      "app/package/[pkg]/markdown.ts has none of the exports a markdown.ts next to a page uses (default, slots, publicCache, notFoundMarkdown): it exports methodology, steps. So it's left out, and /package/[pkg] converts from its HTML. If it isn't for @affordances/md, move it out of app/ or rename it."
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
  },
  TSC,
)

test(
  "publicCache is typed against next's profiles and next.config's own, and tsc names a typo where it's written",
  () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const config: Config = { cacheLife: { packages: { revalidate: 600, expire: 3600 } } }
    const slots = "export const slots = { readme: async () => '## Readme' }\n"
    expect(check(`${slots}export const publicCache = 'hours'\n`)).toBe('')
    expect(check(`${slots}export const publicCache = { revalidate: 300, expire: 86_400 }\n`)).toBe(
      '',
    )
    // a publicCache alone is a markdown.ts: a converted route that opts in
    expect(check("export const publicCache = 'days'\n")).toBe('')
    // a custom profile, from next.config's cacheLife: typed, through the generated union
    expect(check(`${slots}export const publicCache = 'packages'\n`, config)).toBe('')
    expect(readFileSync(join(root, '.affordances/md.ts'), 'utf8')).toContain(
      'type Profile = CacheLifeProfile | "packages"',
    )
    // a typo, as a name or a field, is tsc's: it's checked against the same union, and named where it's written
    for (const [cache, said] of [
      ["'hourz'", `Did you mean '"hours"'?`],
      [
        '{ revalidat: 300 }',
        "Type '{ revalidat: number; }' is not assignable to type 'PublicCache<Profile> | undefined'.",
      ],
    ] as const) {
      const out = check(`${slots}export const publicCache = ${cache}\n`, config)
      expect(out).toMatch(/^\.affordances\/md\.ts\(\d+,\d+\): error TS2322/m)
      expect(out).toMatch(/app\/package\/\[pkg\]\/markdown/)
      expect(out).toContain(`Types of property 'publicCache' are incompatible.`)
      expect(out).toContain(said)
    }
    // md() no longer reads the value from the source: a comment holding an old value is a comment, and a re-export works
    expect(
      check(
        `${slots}// export const publicCache = 'hourz'\nexport const publicCache = 'hours'\n`,
        config,
      ),
    ).toBe('')
    writeFileSync(
      join(root, 'app/package/[pkg]/cache.ts'),
      "export const publicCache = 'packages'\n",
    )
    writeFileSync(
      join(root, 'app/package/[pkg]/markdown.ts'),
      `${slots}export { publicCache } from './cache.ts'\n`,
    )
    md({ root })(config)
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  },
  TSC,
)

test(
  "after a markdown.ts that isn't one is moved, as its error says, tsc passes again",
  () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(check('export const methodology = { steps: 3 }\n')).toMatch(/TS2344/)
    // moved out of app/, as the error said: md() runs again, and its file from the last build no longer holds the error
    renameSync(join(root, 'app/package/[pkg]/markdown.ts'), join(root, 'methodology.ts'))
    md({ root })({})
    const run = () => {
      try {
        execFileSync(process.execPath, [tsc, '-p', root, '--pretty', 'false'], {
          encoding: 'utf8',
          cwd: root,
        })
        return ''
      } catch (failed) {
        return String((failed as { stdout: string }).stdout)
      }
    }
    expect(run()).toBe('')
    expect(readFileSync(join(root, '.affordances/md.ts'), 'utf8')).toContain(
      'export const routes = {}',
    )
    error.mockRestore()
  },
  TSC,
)
