import { StarIcon } from 'lucide-react'
import { cn } from 'cn'

// the stars are drawn for the eye; a screen reader gets "4.7 out of 5 stars"
export const Stars = ({ rating, className }: { rating: number; className?: string }) => (
  <span className={cn('inline-flex gap-px text-foreground', className)}>
    {[1, 2, 3, 4, 5].map((n) => (
      <StarIcon
        key={n}
        aria-hidden
        className={cn('size-3.5', n <= Math.round(rating) ? 'fill-current' : 'opacity-25')}
      />
    ))}
    <span className="sr-only">{rating} out of 5 stars</span>
  </span>
)
