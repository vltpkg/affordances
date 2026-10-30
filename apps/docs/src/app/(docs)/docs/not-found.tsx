import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { VltBlueprint } from '@/components/vlt-blueprint'

export const metadata: Metadata = { title: 'Page not found' }

const NotFound = () => (
  // the inset is a flex column filling the viewport below the navbar, so flex-1 centres in the visible area
  <div className="flex flex-1 flex-col items-center justify-center text-center">
    <VltBlueprint className="w-44" />
    {/* the pixel face is drawn at a single weight, so no bold or tight tracking */}
    <h1 className="mt-10 font-pixel text-7xl tabular-nums">404</h1>
    <p className="mt-3 text-lg text-muted-foreground">This page doesn’t exist.</p>
    <Button asChild size="lg" className="mt-8 rounded-full px-5">
      <Link href="/">Return Home</Link>
    </Button>
  </div>
)

export default NotFound
