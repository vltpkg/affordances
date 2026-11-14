import { declines, forcePath, type Path } from '../../../../src/convert/path.ts'
import { htmlToMarkdown, readPage, type Options } from '../../../../src/index.ts'

// what a read gives on both paths: the tree pipeline's, then md-core's (by default as md runs it, so it can decline;
// 'strict' when it must write the page), and why md-core declined it, if it did
export const onBoth = <T>(read: () => T, core: Path = 'core') => {
  try {
    forcePath('hast')
    const tree = read()
    forcePath(core)
    declines.clear()
    return { core: read(), tree, declined: [...declines.keys()] }
  } finally {
    forcePath(undefined)
  }
}

// a page through md (htmlToMarkdown, and readPage with a fill): what each path writes, and why md-core declined it
const read = (html: string, options: Options) => {
  const page = readPage(html, options)
  const { markdown, ...rest } = page
  return JSON.stringify([htmlToMarkdown(html, options), rest, markdown({ a: 'F' })])
}
export const both = (html: string, options: Options = {}) => onBoth(() => read(html, options))
