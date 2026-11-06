// a page's markdown twin: / → /index.md, /blog/post/ → /blog/post.md. no React, no Next: shared by both entries
export const mdPath = (path: string) =>
  path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`
