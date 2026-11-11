import Link from 'next/link'
import { cacheLife } from 'next/cache'
import { cn } from 'cn'
import { Vlt } from '@/components/icons/vlt'
import { socials } from '@/components/social-strip'
import { ThemeSwitcher } from '@/components/theme-switcher'

const vlt = (path: string) => `https://www.vlt.io${path}`

// vlt.io's footer (apps/www/src/components/marketing/navigation/footer), its links pointed at vlt.io
const groups = [
  {
    label: 'Open Source',
    links: [
      { title: 'Package Manager', href: vlt('/open-source/client') },
      { title: 'Serverless Registry', href: vlt('/open-source/serverless-registry') },
      { title: 'Policies', href: vlt('/open-source/policies') },
      { title: 'Reproduce', href: vlt('/open-source/reproduce') },
      { title: 'Packages & Ecosystem', href: vlt('/open-source') },
    ],
  },
  {
    label: 'Platform',
    links: [
      { title: 'Registry', href: vlt('/platform/registry') },
      { title: 'Security', href: vlt('/platform/security') },
      { title: 'Observability', href: vlt('/platform/observability') },
      { title: 'Packages', href: vlt('/platform/packages') },
      { title: 'Projects', href: vlt('/platform/projects') },
    ],
  },
  {
    label: 'Resources',
    links: [
      { title: 'Blog', href: vlt('/blog') },
      { title: 'Press', href: vlt('/press') },
      { title: 'Brand Kit', href: vlt('/brand-kit') },
      { title: 'Benchmarks', href: 'https://benchmarks.vlt.sh/' },
      { title: 'Documentation', href: 'https://docs.vlt.io' },
    ],
  },
  {
    label: 'Company',
    links: [
      { title: 'About', href: vlt('/about') },
      { title: 'Careers', href: vlt('/careers') },
      { title: 'Status', href: 'https://status.vlt.io' },
      { title: 'Contact', href: vlt('/contact') },
    ],
  },
  {
    label: 'Legal',
    links: [
      { title: 'Terms', href: vlt('/terms') },
      { title: 'Privacy', href: vlt('/privacy') },
      { title: 'Security', href: vlt('/security') },
    ],
  },
]

const link = 'text-muted-foreground hover:text-foreground text-sm transition-colors duration-150'

export const SiteFooter = () => (
  <footer className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-16 px-14 py-16 max-[899px]:px-5 lg:gap-24">
    <div
      aria-hidden
      className="absolute inset-x-0 top-0 h-px bg-radial from-border to-background"
    />

    <div className="grid w-full grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:flex lg:justify-between">
      {groups.map((g) => (
        <nav key={g.label} aria-label={g.label} className="flex flex-col gap-3">
          <span className="text-sm font-medium text-foreground">{g.label}</span>
          <ul className="flex flex-col gap-2">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} prefetch={false} className={link}>
                  {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </div>

    <div className="flex w-full flex-col gap-6">
      <Vlt className="size-6" aria-label="vlt" />
      <div className="flex flex-wrap items-center justify-between gap-6">
        <Status />
        <div className="flex items-center gap-6">
          <ul className="flex items-center gap-4">
            {socials.map(({ href, label, Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className={link}
                >
                  <Icon aria-hidden className="size-4.5" />
                </a>
              </li>
            ))}
          </ul>
          <ThemeSwitcher />
        </div>
      </div>
    </div>
  </footer>
)

// vlt.io's status line (components/vlt-status.tsx, its plain variant): cached, so it's in the static
// shell; nothing renders when statuspage can't be reached
const getStatus = async (): Promise<{ indicator: string; description: string } | null> => {
  'use cache'
  cacheLife('minutes')
  try {
    const res = await fetch('https://status.vlt.io/api/v2/status.json')
    return res.ok ? ((await res.json()).status ?? null) : null
  } catch {
    return null
  }
}

const tones: Record<string, string> = {
  none: 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 [--dot:var(--color-emerald-500)]',
  minor: 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 [--dot:var(--color-amber-500)]',
}

const Status = async () => {
  const s = await getStatus()
  if (!s) return <span />
  return (
    <a
      href="https://status.vlt.io"
      className={cn(
        '-mx-1.5 inline-flex w-fit items-center gap-1.5 px-1.5 py-1 font-mono text-[11px] tracking-wide uppercase transition-colors duration-150',
        tones[s.indicator] ??
          'text-red-600 dark:text-red-400 hover:bg-red-500/10 [--dot:var(--color-red-500)]',
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--dot)" />
      {s.description.replace(/\.?$/, '.')}
    </a>
  )
}
