import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { emailScan, TRIALS_ROOT, userEmail } from './drivers/isolation.ts'

// a run's raw traces as the committed archive (intake, 2026-11-18): unedited, except that the user's email, wherever it
// appears, is replaced by a marked redaction. Personal data overrides 'raw traces unedited'. The address is read at run
// time and written nowhere; the unredacted originals stay where the run left them, outside git

export const REDACTED = '[email redacted]'

export const archive = (results: string, tarball: string, email = userEmail()) => {
  const scan = emailScan(results, email)
  // fails closed (review's boundary #6): a scan that couldn't check, because no address was readable, can't vouch
  // that the traces hold none, so nothing is archived. Before any copy is made, so nothing is left behind
  if (!email || !scan.checked)
    throw new Error(
      "the email scan couldn't check (no address to scan for), so no archive is written",
    )
  // the copy is made beside the trials, never in /tmp
  const work = mkdtempSync(path.join(path.dirname(TRIALS_ROOT), 'archive-'))
  try {
    cpSync(results, work, { recursive: true })
    if (scan.found)
      for (const rel of readdirSync(work, { recursive: true, encoding: 'utf8' })) {
        const file = path.join(work, rel)
        if (!statSync(file).isFile()) continue
        const text = readFileSync(file, 'latin1')
        if (text.includes(email)) writeFileSync(file, text.replaceAll(email, REDACTED), 'latin1')
      }
    execFileSync('tar', ['-czf', path.resolve(tarball), '-C', work, '.'])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  // what the README records: whether it was found and how often, never the address
  return scan
}

// node src/archive.ts <results dir> <traces.tar.gz>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [results, tarball] = process.argv.slice(2) as [string, string]
  console.log(JSON.stringify(archive(results, tarball)))
}
