import type { Manifest } from '@affordances/core'

// a stand-in: withAffordances aliases @affordances/next/manifest to the app's .affordances/manifest.ts, so the
// route handler finds it without a relative import. reaching this file means the config isn't wrapped
export const manifest: Manifest | undefined = undefined
