import Link from 'next/link'
import { cn } from 'cn'
import { Vlt } from '@/components/icons/vlt'

// vlt.io's logo, as two links: the mark and "vlt" go to vlt, "affordances" to this site's home
export const Logo = ({ className, onClick }: { className?: string; onClick?: () => void }) => (
  <div
    className={cn(
      'flex h-9 items-center bg-linear-to-tr from-neutral-600 to-neutral-950 bg-clip-text py-1 text-lg font-semibold dark:from-neutral-500 dark:to-neutral-100',
      className,
    )}
  >
    <a
      href="https://www.vlt.io"
      aria-label="vlt home"
      className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Vlt className="size-6" aria-hidden="true" />
      vlt
    </a>
    <span className="font-normal whitespace-pre text-muted-foreground" aria-hidden>
      {' / '}
    </span>
    <Link
      href="/"
      aria-label="Affordances home"
      onClick={onClick}
      className="rounded-md font-normal text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* Geist Pixel draws 1.5px cells at 19.75px (its cell is 0.076em), so it stays crisp next to the 18px text */}
      <span className="font-pixel text-[19.75px] leading-none">affordances</span>
    </Link>
  </div>
)
