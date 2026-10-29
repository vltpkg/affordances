import { defineState } from '@afford/next'
import { sections } from '@/lib/source'

// the docs' table of contents; getPage reads any page in it
export default defineState(() => ({
  site: { name: 'Afford docs', llms: '/llms.txt', markdown: 'Append .md to any page url' },
  sections: sections(),
}))
