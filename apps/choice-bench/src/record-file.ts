import { renameSync, writeFileSync } from 'node:fs'

/** A tool server's record, written whole or not at all: to a temporary file, then renamed over the last one. */
export const writeRecordAtomic = (file: string, record: unknown) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(record))
  renameSync(`${file}.tmp`, file)
}
