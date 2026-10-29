import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { Application, Converter, ReflectionKind, type TypeDocOptions } from 'typedoc'
import { MarkdownPageEvent, type PluginOptions } from 'typedoc-plugin-markdown'
import typedocWorkspace from '../typedoc.workspace.mjs'

const packagesDir = resolve(import.meta.dirname, '../../../packages')
const target = resolve(import.meta.dirname, '../content/reference/api-reference')
// typedoc writes into a scratch folder, then only changed files are copied over: rewriting all ~50 pages on
// every run (predev included) makes a running dev server reload over and over while modules vanish under it
const out = mkdtempSync(join(tmpdir(), 'afford-typedoc-'))
const wanted = process.env.AFFORD_TYPEDOC_PACKAGES?.split(',')
const check = process.argv.includes('--check')

const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && (!wanted || wanted.includes(d.name)))
  .map((d) => resolve(packagesDir, d.name))
  .flatMap((dir) => {
    const options = typedocWorkspace(dir)
    return options ? [{ dir, ...options }] : []
  })

const packageOptions: Partial<TypeDocOptions> = {
  excludeInternal: true,
  excludeExternals: true,
  excludePrivate: true,
  excludeProtected: true,
  skipErrorChecking: true,
  // the docs link to source on GitHub elsewhere; per-symbol source links need a git remote this checkout lacks
  disableSources: true,
  // every type a public signature mentions must be exported, and every link must resolve
  validation: { notExported: true, invalidLink: true, rewrittenLink: true },
}

const markdownOptions: Partial<PluginOptions> = {
  entryFileName: 'index',
  modulesFileName: 'reference',
  outputFileStrategy: 'modules',
  excludeScopesInPaths: true,
  useCodeBlocks: true,
  hideBreadcrumbs: true,
  hidePageHeader: true,
  hidePageTitle: true,
  parametersFormat: 'table',
  interfacePropertiesFormat: 'table',
  classPropertiesFormat: 'table',
  enumMembersFormat: 'table',
  propertyMembersFormat: 'table',
  typeDeclarationFormat: 'table',
  indexFormat: 'table',
  // typedoc merges flags over their defaults, so a partial object is fine;
  // modifiers are nearly all `public` (private/protected are excluded) and cost a column
  tableColumnSettings: {
    hideModifiers: true,
    hideSources: true,
    leftAlignHeaders: true,
  } as PluginOptions['tableColumnSettings'],
}

// one typedoc run per package: each package's entry points are its own exports, which the `packages`
// strategy would only read from a typedoc config inside the package
let failed = false
for (const pkg of packages) {
  const app = await Application.bootstrapWithPlugins({
    ...packageOptions,
    name: pkg.name,
    entryPoints: pkg.entryPoints,
    entryPointStrategy: 'resolve',
    tsconfig: resolve(pkg.dir, 'tsconfig.json'),
    plugin: ['typedoc-plugin-markdown'],
    readme: pkg.readme ?? 'none',
    out: resolve(out, basename(pkg.dir)),
    ...markdownOptions,
  })

  // a package with several entry points has a module per entry; its main one (src/index.ts) is named
  // `index`, which would collide with the readme's index.md, so it takes the name it's imported by
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const entry of context.project.getChildrenByKind(ReflectionKind.Module))
      if (entry.name === 'index') entry.name = pkg.name
  })

  // fumadocs requires a frontmatter title on every page
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    // index.md is the package's readme, named for the package (the sidebar shows it as the folder's
    // Overview); each entry point's page is named as it's imported
    const name = page.model.name
    const title =
      page.url === 'index.md'
        ? pkg.name
        : page.url === 'reference.md'
          ? 'Reference'
          : page.model.kindOf?.(ReflectionKind.Module) && !name.startsWith('@')
            ? `${pkg.name}/${name}`
            : name
    page.contents = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${page.contents ?? ''}`
  })

  const project = await app.convert()
  if (!project) {
    failed = true
    continue
  }
  if (check) {
    // notExported and invalidLink are on by default; as with the CLI's --treatValidationWarningsAsErrors,
    // any validation warning fails and nothing is written
    const warnings = app.logger.warningCount
    app.validate(project)
    if (app.logger.hasErrors() || app.logger.warningCount > warnings) failed = true
    continue
  }
  await app.generateOutputs(project)

  // the folder is named for the package (a meta.json without a title would name it after the directory);
  // sidebar order inside it: its main entry point, the other entry points, then
  // the reference (alphabetical would put `config` before the package itself)
  const dir = resolve(out, basename(pkg.dir))
  const main = basename(pkg.dir)
  const pages = readdirSync(dir)
    // index.md is the folder's own page (the sidebar's Overview), so it isn't listed
    .filter((file) => file.endsWith('.md') && file !== 'index.md')
    .map((file) => file.slice(0, -3))
  const rank = (page: string) => (page === main ? 0 : page === 'reference' ? 2 : 1)
  writeFileSync(
    resolve(dir, 'meta.json'),
    `${JSON.stringify({ title: pkg.name, pages: pages.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b)) })}\n`,
  )
}

// a package without a description is described by its readme's first paragraph
const summary = (readme?: string) =>
  readme
    ? (
        readFileSync(readme, 'utf8')
          .split(/\n\n+/)
          .find((block) => !block.startsWith('#')) ?? ''
      )
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '\\|')
    : ''

// the folder's own page: every package, linking to its readme
if (!check && !failed) {
  mkdirSync(out, { recursive: true })
  writeFileSync(
    resolve(out, 'index.md'),
    `---\ntitle: "API reference"\ndescription: "Generated from each package's source with TypeDoc."\n---\n\n## Packages\n\n| Package | Description |\n| :-- | :-- |\n${packages
      .map(
        (p) =>
          `| [${p.name}](${basename(p.dir)}/index.md) | ${(p.description ?? summary(p.readme)).replace(/</g, '&lt;')} |`,
      )
      .join('\n')}\n`,
  )
}
// mirror the scratch folder into content/reference/api-reference, touching only what differs
const files = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    : []
if (!check && !failed) {
  const fresh = new Set(files(out))
  for (const file of fresh) {
    const next = readFileSync(join(out, file))
    const to = join(target, file)
    if (existsSync(to) && readFileSync(to).equals(next)) continue
    mkdirSync(resolve(to, '..'), { recursive: true })
    writeFileSync(to, next)
  }
  for (const file of files(target)) if (!fresh.has(file)) rmSync(join(target, file))
  // folders left empty by a removed package
  for (const entry of existsSync(target) ? readdirSync(target, { withFileTypes: true }) : [])
    if (entry.isDirectory() && !files(join(target, entry.name)).length)
      rmSync(join(target, entry.name), { recursive: true })
}
rmSync(out, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
