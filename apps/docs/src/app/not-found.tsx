import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Navbar } from '@/components/navbar'
import { SiteFooter } from '@/components/site-footer'
import { VltBlueprint } from '@/components/vlt-blueprint'

export const metadata: Metadata = { title: 'Page not found' }

// outside /docs (whose own not-found renders inside the docs shell), so it brings the header and footer
const NotFound = () => (
  <>
    <Navbar />
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <VltBlueprint className="w-44" />
      {/* the pixel face is drawn at a single weight, so no bold or tight tracking */}
      <h1 className="mt-10 font-pixel text-7xl tabular-nums">404</h1>
      <p className="mt-3 text-lg text-muted-foreground">This page doesn’t exist.</p>
      <Button asChild size="lg" className="mt-8 rounded-full px-5">
        <Link href="/">Return Home</Link>
      </Button>
    </main>
    <SiteFooter />
  </>
)

export default NotFound
