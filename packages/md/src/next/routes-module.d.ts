// the handler imports the routes by package name, so the app's alias can swap in its own; this types it before
// dist/routes.d.ts exists
declare module '@affordances/md/routes' {
  export const routes: import('./index.ts').MarkdownRoutes | undefined
}
