// the route handler imports the manifest by package name, so the app's alias can swap in its own; this types it
// before dist/manifest.d.ts exists
declare module '@affordances/next/manifest' {
  export const manifest: import('@affordances/core').Manifest | undefined
}
