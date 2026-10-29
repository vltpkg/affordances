// the header's links: the docs' four sections, each landing on its overview
export const links = [
  { label: 'Quickstart', href: '/docs/quickstart' },
  { label: 'Concepts', href: '/docs/concepts' },
  { label: 'Guides', href: '/docs/guides' },
  { label: 'Reference', href: '/docs/reference' },
]

// a section link is current anywhere inside its section
export const isCurrent = (href: string, pathname: string) =>
  pathname === href || pathname.startsWith(`${href}/`)
