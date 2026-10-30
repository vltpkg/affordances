'use client'

import { useState } from 'react'
import { cn } from 'cn'
import { ProductArt } from './product-art'

// the drawing stands in for photography: a full view, then closer crops around its detail
export const Gallery = ({
  slug,
  name,
  focus: [x, y],
  className,
}: {
  slug: string
  name: string
  focus: [number, number]
  className?: string
}) => {
  const crop = (size: number) => `${x - size / 2} ${y - size / 2} ${size} ${size}`
  const views = [
    { label: 'front', viewBox: '0 0 96 96' },
    { label: 'detail', viewBox: crop(48) },
    { label: 'close-up', viewBox: crop(28) },
  ]
  const [shown, setShown] = useState(0)

  return (
    <div className={className}>
      <ProductArt
        slug={slug}
        alt={`${name}, ${views[shown]!.label}`}
        viewBox={views[shown]!.viewBox}
        className="max-md:aspect-[4/3]"
      />
      <ul className="mt-3 grid grid-cols-5 gap-2">
        {views.map((view, i) => (
          <li key={view.label}>
            <button
              type="button"
              onClick={() => setShown(i)}
              aria-current={i === shown || undefined}
              aria-label={`Show ${view.label} view`}
              className={cn(
                'block w-full rounded-md outline-none ring-offset-2 ring-offset-background transition-shadow duration-150 ease-out',
                'hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/50 aria-current:ring-1 aria-current:ring-foreground',
              )}
            >
              <ProductArt slug={slug} viewBox={view.viewBox} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
