import { cn } from 'cn'

// each drawing sits on a 96 × 96 grid; strokes stay 1.25px at any size
const art: Record<string, React.ReactNode> = {
  'heavyweight-tee': (
    <>
      <path d="M38 22 24 27 15 41l10 5 4-5v35h38V41l4 5 10-5-9-14-14-5c-2 5-6 7-10 7s-8-2-10-7Z" />
      <path d="M41 23.5c1.5 3.5 4 5 7 5s5.5-1.5 7-5" />
      <path d="M29 72h38" />
    </>
  ),
  'six-panel-cap': (
    <>
      <path d="M24 60c0-19 10.5-32 24-32s24 13 24 32" />
      <path d="M48 28c-7 7-11 18-12 32M48 28c7 7 11 18 12 32M48 28v32" />
      <circle cx="48" cy="26.5" r="1.5" />
      <path d="M18 62c9-4 51-4 60 0-5 8-55 8-60 0Z" />
    </>
  ),
  'keycap-set': (
    <>
      {[
        [23, 23],
        [51, 23],
        [23, 51],
        [51, 51],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width="22" height="22" rx="3" />
          <rect x={x! + 4} y={y! + 3} width="14" height="13" rx="2" />
        </g>
      ))}
      <path d="M31.5 64.5h5" />
    </>
  ),
  'sticker-sheet': (
    <>
      <path d="M28 18h40v48L58 76H28Z" />
      <path d="M68 66H60a2 2 0 0 0-2 2v8" />
      <circle cx="39" cy="31" r="6" />
      <rect x="50" y="25" width="12" height="12" rx="3" />
      <path d="m39 46 6.5 11h-13Z" />
      <circle cx="56" cy="52" r="5" />
    </>
  ),
  'dot-grid-notebook': (
    <>
      <rect x="29" y="16" width="38" height="60" rx="3" />
      <path d="M35 16v60M60 16v60" />
      <path d="M45 76v9l3-3 3 3v-9" />
    </>
  ),
  'grid-poster': (
    <>
      <rect x="26" y="16" width="44" height="62" rx="1" />
      <circle cx="48" cy="40" r="12" />
      <path d="M34 62h28M34 68h16" />
      <path d="M44 14v4M52 14v4" />
    </>
  ),
  'canvas-tote': (
    <>
      <path d="M25 40h46l-3 40H28Z" />
      <path d="M36 40c0-20 24-20 24 0" />
      <path d="M26 46h44" />
    </>
  ),
  'enamel-mug': (
    <>
      <path d="M28 30h32v38a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6Z" />
      <path d="M28 35h32" />
      <path d="M60 40h4a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-4" />
    </>
  ),
}

// decorative by default; pass alt where the drawing stands in for a product photo
export const ProductArt = ({
  slug,
  alt,
  viewBox = '0 0 96 96',
  className,
}: {
  slug: string
  alt?: string
  viewBox?: string
  className?: string
}) => (
  <div className={cn('aspect-square rounded-md bg-muted text-foreground', className)}>
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      className="size-full [&_*]:[vector-effect:non-scaling-stroke]"
    >
      {art[slug]}
    </svg>
  </div>
)
