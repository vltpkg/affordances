import { signature } from '@affordances/mcp'
import type { Delta, Graph } from '@affordances/protocol'
import type { Step } from './project.ts'

// the human side of each command; --json prints the same results as data instead

const pad = (rows: string[][]) => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]?.length ?? 0))) ?? []
  return rows.map((r) =>
    r
      .map((cell, i) => cell.padEnd(widths[i]!))
      .join('  ')
      .trimEnd(),
  )
}

export const steps = (list: Step[]) =>
  pad(list.map((s) => [s.status, s.path, s.note ?? ''])).join('\n')

export const initDone = ({ steps: list }: { steps: Step[] }) =>
  [
    steps(list),
    '',
    list.some((s) => s.status === 'todo')
      ? 'Finish the todo above, then add state.ts and actions.ts next to a page.'
      : 'Next: add state.ts and actions.ts next to a page, and set `expose` on each action.',
  ].join('\n')

export const built = ({ routes, manifest }: { routes: string[]; manifest: string }) =>
  [
    `${routes.length} ${routes.length === 1 ? 'route' : 'routes'} → ${manifest}`,
    ...routes.map((r) => `  ${r}`),
  ].join('\n')

// the graph as an agent would skim it: what's on the page, what can be done, where to go next
export const graph = ({ graph: g, tokens }: { graph: Graph; tokens: number }) => {
  const entities = Object.keys(g.entities)
  return [
    `${g.page}  (${g.route})  ~${tokens.toLocaleString('en-US')} tokens`,
    '',
    `Entities  ${entities.length ? entities.join(', ') : 'none'}`,
    '',
    g.actions.length ? 'Actions' : 'Actions  none',
    ...pad(
      g.actions.map((a) => [
        `  ${a.available ? '✓' : '✗'} ${signature(a.name, a.input as Parameters<typeof signature>[1])}`,
        `${a.expose}${a.readOnly ? ', read-only' : ''}`,
        a.available ? '' : (a.reason ?? 'unavailable'),
      ]),
    ),
    ...(g.nav?.length
      ? [
          '',
          'Nav',
          ...pad(g.nav.map((n) => [`  ${n.to}`, n.label ?? '', n.when ? `(${n.when})` : ''])),
        ]
      : []),
  ].join('\n')
}

export const delta = ({ action, delta: d }: { action: string; delta: Delta }) =>
  [
    d.ok ? `${action}: ok` : `${action}: ${d.error?.code ?? 'failed'}`,
    ...(d.error ? [`  ${d.error.message}`] : []),
    ...(d.message ? [`  ${d.message}`] : []),
    ...(d.changed ? [`  changed: ${Object.keys(d.changed).join(', ')}`] : []),
    ...(d.redirect ? [`  redirect: ${d.redirect}`] : []),
    ...(d.error?.code === 'confirm_required'
      ? ['  Rerun with --confirm once the person approves.']
      : []),
  ].join('\n')
