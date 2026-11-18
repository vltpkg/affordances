import type { Metadata } from 'next'
import Link from 'next/link'
import { fontVariables } from '@affordances/ui/lib/fonts'
import '@affordances/ui/globals.css'
import { WebMcp } from '@/components/webmcp'

export const metadata: Metadata = {
  title: { default: 'Hosting Lab', template: '%s · Hosting Lab' },
  description:
    'A fictional hosting provider, for studying how agents choose. Nothing here is real or billed.',
}

const nav = [
  { href: '/', label: 'Project' },
  { href: '/plans', label: 'Plans' },
  { href: '/add-ons', label: 'Add-ons' },
  { href: '/deployments', label: 'Deployments' },
]

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html lang="en" className={`${fontVariables} h-full antialiased`}>
    <body className="text-body flex min-h-full flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="font-medium">
            Hosting Lab
          </Link>
          <nav aria-label="Main" className="flex gap-4 text-sm text-muted-foreground">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-20 sm:px-6">{children}</main>
      <WebMcp />
      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        A fictional provider with invented prices. Nothing is charged.
      </footer>
    </body>
  </html>
)

export default RootLayout
