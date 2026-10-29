import { Children, isValidElement } from 'react'
import { Table } from '@afford/ui/components/table'

type Children = { children?: React.ReactNode }

// first-column headers of reference tables: options, props, fields
const apiHeaders = new Set([
  'Option',
  'Prop',
  'Property',
  'Argument',
  'Field',
  'Tool field',
  'Rule',
  'Command',
  'Import',
  'Tool',
])

const firstChildren = (node: React.ReactNode) =>
  Children.toArray(node).find(isValidElement<Children>)?.props.children

// MDX hands server components unrendered children, so the header cell reads as table > thead > tr > th > text
const firstHeader = (children: React.ReactNode) => {
  const text = firstChildren(firstChildren(firstChildren(children)))
  return typeof text === 'string' ? text : undefined
}

// the card clips the header tint to its rounded corners; ui/table's own container does the scrolling
const card =
  'not-first:mt-(--typeset-flow) overflow-hidden rounded-(--radius) border [&_thead]:bg-muted/60'
// reference tables: muted, with the name in the first column standing out
const api = `${card} [&_td]:text-muted-foreground [&_td:first-child_code:first-of-type]:text-foreground [&_th]:text-muted-foreground`

// every markdown table becomes a bordered card that scrolls inside itself
export const TypeTable = (props: React.ComponentProps<'table'>) => (
  <div className={apiHeaders.has(firstHeader(props.children) ?? '') ? api : card}>
    <Table {...props} />
  </div>
)
