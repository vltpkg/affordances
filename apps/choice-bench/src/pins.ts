import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pin from './pins/mcp-main.json' with { type: 'json' }

// the v0 cell's guarantee (the planner, 14:38Z): it runs main's packages/mcp, the published 0.5.1 tools, byte for byte.
// Each tracked file's git blob hash on main is pinned here with the commit it came from (src/pins/mcp-main.json, from
// `git ls-tree -r main packages/mcp`), and the preflight checks the tree a run uses against it. A pinned export has
// no git, so the hash is git's own, recomputed: sha1 of 'blob <length>\0' and the bytes

/** Git's blob hash of a file's bytes. */
export const gitBlobHash = (bytes: Buffer) =>
  createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/** packages/mcp under root against main's pin: every pinned file present, and each the same bytes. */
export const checkMcpPin = (
  root: string,
  expected: { commit: string; files: Record<string, string> } = pin,
) => {
  const differ = Object.entries(expected.files).flatMap(([file, sha]) => {
    const at = path.join(root, file)
    if (!existsSync(at)) return [{ file, reason: 'missing' }]
    return gitBlobHash(readFileSync(at)) === sha ? [] : [{ file, reason: 'differs' }]
  })
  return {
    commit: expected.commit,
    files: Object.keys(expected.files).length,
    ok: differ.length === 0,
    differ,
  }
}
