import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

// M7f's pinned export (the planner, 2026-11-18 17:13Z): one export, built once, made read-only, and its whole tree
// hashed into pin.json beside it. The preflight re-checks the hash at every launch and resume, so any drift, a rebuild
// or an edit, refuses the run

export const PIN_FILE = 'pin.json'

/**
 * The whole tree's sha256: every entry's path relative to the root, in code-unit order, with a file's bytes or a
 * symlink's own target text (never followed, so node_modules' links can't loop or reach outside). pin.json itself is
 * left out, since it's written after the hash.
 */
export const treeHash = (root: string) => {
  const hash = createHash('sha256')
  const visit = (rel: string) => {
    const at = path.join(root, rel)
    const stat = lstatSync(at)
    if (stat.isSymbolicLink()) {
      hash.update(`l ${rel}\0${readlinkSync(at)}\0`)
      return
    }
    if (stat.isDirectory()) {
      hash.update(`d ${rel}\0`)
      const names = readdirSync(at).toSorted()
      for (const name of names)
        if (!(rel === '' && name === PIN_FILE)) visit(rel ? `${rel}/${name}` : name)
      return
    }
    hash.update(`f ${rel}\0${stat.size}\0`)
    hash.update(readFileSync(at))
    hash.update('\0')
  }
  visit('')
  return hash.digest('hex')
}

/** What pin.json records, among other fields: the tree hash is the one the preflight re-checks. */
export type Pin = { commit: string; treeHash: string; [field: string]: unknown }

/** The export against its pin: present, and its tree the same bytes as when it was pinned. */
export const checkPin = (root: string) => {
  const file = path.join(root, PIN_FILE)
  if (!existsSync(file)) return { ok: false as const, reason: `no ${PIN_FILE} beside the export` }
  const pin = JSON.parse(readFileSync(file, 'utf8')) as Pin
  const actual = treeHash(root)
  return actual === pin.treeHash
    ? { ok: true as const, commit: pin.commit, treeHash: actual }
    : {
        ok: false as const,
        commit: pin.commit,
        reason: `the export's tree is ${actual}, not the pinned ${pin.treeHash}`,
      }
}
