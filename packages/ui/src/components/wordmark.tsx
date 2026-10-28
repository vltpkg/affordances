import { cn } from 'cn'

// Geist Pixel's cell is 0.076em, so 19.75px draws 1.5px cells: three device pixels each on a 2x screen
export const Wordmark = ({ className }: { className?: string }) => (
  <span className={cn('font-pixel text-[19.75px] leading-none', className)}>afford</span>
)
