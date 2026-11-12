// turndown ships no types and @types/turndown isn't installed; the bench needs only this much
declare module 'turndown' {
  export default class TurndownService {
    constructor(options?: Record<string, unknown>)
    use(plugin: unknown): this
    turndown(html: string): string
  }
}

declare module 'turndown-plugin-gfm' {
  export const gfm: unknown
}
