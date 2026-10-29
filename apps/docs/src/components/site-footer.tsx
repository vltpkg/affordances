import Link from 'next/link'
import { BotIcon } from 'lucide-react'
import { SocialStrip } from '@/components/social-strip'

const link =
  'inline-flex items-center gap-1.5 rounded-sm text-muted-foreground no-underline transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'

// the marketing page's footer: copyright on the left, its links and the socials strip (with the theme
// switcher) on the right, wrapping under each other on phones
export const SiteFooter = () => (
  <footer className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-[18px] text-sm text-muted-foreground">
    <span>© 2026 vlt technology inc, All rights reserved</span>
    <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <a href="https://www.vlt.io/about" className={link}>
        About
      </a>
      <Link href="/docs" className={link}>
        Docs
      </Link>
      <Link href="/docs/bench" className={link}>
        Methodology
      </Link>
      <Link href="/agents" className={link}>
        <BotIcon aria-hidden className="size-[15px]" />
        For agents
      </Link>
      <SocialStrip />
    </nav>
  </footer>
)
