'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from 'cn'

// connectors are measured, not assumed, so they follow the real layout: draw runs on mount, whenever
// root resizes, and once the fonts land
export const useConnectors = (
  root: React.RefObject<HTMLElement | null>,
  draw: () => string[],
): string[] => {
  const [paths, setPaths] = useState<string[]>([])
  // draw only reads refs, so the first one stays good; holding it keeps the effect to one run
  const latest = useRef(draw)
  useLayoutEffect(() => {
    const measure = () => setPaths(latest.current())
    measure()
    const ro = new ResizeObserver(measure)
    if (root.current) ro.observe(root.current)
    document.fonts?.ready.then(measure, () => {})
    return () => ro.disconnect()
  }, [root])
  return paths
}

// one origin on svg's left edge (the middle of `from`) fanning out to the middle of each target on its
// right edge. each curve leaves and arrives level, so the fan reads as one source
export const fan = (
  svg: SVGSVGElement | null,
  from: Element | null | undefined,
  to: (Element | null)[],
): string[] => {
  const box = svg?.getBoundingClientRect()
  const o = from?.getBoundingClientRect()
  if (!box?.width || !o) return []
  const y0 = o.top + o.height / 2 - box.top
  const w = box.width
  return to.map((el) => {
    const r = el!.getBoundingClientRect()
    const y = r.top + r.height / 2 - box.top
    return `M0 ${y0} C ${w * 0.55} ${y0}, ${w * 0.45} ${y}, ${w} ${y}`
  })
}

// the fan's origin point, read off its first path
export const Origin = ({ paths, className }: { paths: string[]; className?: string }) =>
  paths[0] ? (
    <circle cx={0} cy={Number(paths[0].split(' ')[1])} r={3.5} className={className} />
  ) : null

// one pulse down a connector. under reduced motion it never shows (marketing.css)
export const Pulse = ({ d, className }: { d: string; className?: string }) => (
  <path
    d={d}
    fill="none"
    pathLength={1}
    strokeWidth={3}
    strokeLinecap="round"
    className={cn('pulse', className)}
  />
)
