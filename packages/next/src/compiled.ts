// a stand-in, as @affordances/next/manifest is: withAffordances aliases @affordances/next/compiled to the app's
// .affordances/capabilities.ts, which writeCompiled always writes, so the route handler finds the compiled manifest
// without reading the file system at request time (RFC 0004 §2). Reaching this file means there's none to serve

/** @experimental The compiled capability manifest's canonical JSON and digest, or null when there's no manifest. */
export const capabilities: { canonical: string; digest: string } | null = null
