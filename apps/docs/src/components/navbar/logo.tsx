import NextLink from 'next/link'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Vlt } from '@/components/icons/vlt'

// vlt.io's logo; links to the docs home
export const Logo = ({ className, ...rest }: React.ComponentProps<typeof Button>) => (
  <Button {...rest} variant="ghost" className={cn('h-9 p-0 has-[>svg]:px-0', className)} asChild>
    <NextLink href="/" className="cursor-pointer" aria-label="vlt afford docs home">
      <Vlt className="size-6" aria-hidden="true" />
      <p className="bg-linear-to-tr from-neutral-600 to-neutral-950 bg-clip-text py-1 text-lg font-semibold dark:from-neutral-500 dark:to-neutral-100">
        vlt{' '}
        <span className="font-normal text-muted-foreground">
          /{' '}
          {/* Geist Pixel draws 1.5px cells at 19.75px (its cell is 0.076em), so it stays crisp next to the 18px text */}
          <span className="font-pixel text-[19.75px] leading-none">afford</span>
        </span>
      </p>
    </NextLink>
  </Button>
)
