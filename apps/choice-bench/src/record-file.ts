import { renameSync, writeFileSync } from 'node:fs'

/** A tool server's record, written whole or not at all: to a temporary file, then renamed over the last one. */
export const writeRecordAtomic = (file: string, record: unknown) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(record))
  renameSync(`${file}.tmp`, file)
}

/**
 * A harness fault a surface's server saw while the agent worked, one list on every record that keeps them: the browser
 * failed, a ref from the immediately preceding snapshot didn't resolve, or the page's tools failed. A record archived
 * before the list keeps its own fields, errors and stalls, which its adapter reads the same way.
 */
export type RecordFault = {
  kind: 'browser' | 'ref' | 'page-tools'
  call: number
  tool: string
  detail: string
  ref?: string
}
