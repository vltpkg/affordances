import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@afford/ui/components/button'

export const metadata: Metadata = { title: 'Page not found' }

const NotFound = () => (
  // renders inside the docs layout, whose inset is a flex column filling the viewport below the navbar
  <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
    {/* the pixel face is drawn at a single weight, so no bold or tight tracking */}
    <h1 className="font-pixel text-7xl tabular-nums">404</h1>
    <p className="mt-3 text-lg text-muted-foreground">This page doesn’t exist.</p>
    <p className="mt-1 text-sm text-muted-foreground">
      Agents can read{' '}
      <Link href="/llms.txt" className="underline underline-offset-4 hover:text-foreground">
        /llms.txt
      </Link>{' '}
      for every page.
    </p>
    <Button
      size="lg"
      className="mt-8 h-9 px-4 text-sm"
      render={<Link href="/" />}
      nativeButton={false}
    >
      Back to home
    </Button>
  </div>
)

export default NotFound
