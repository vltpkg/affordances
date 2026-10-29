import type { Metadata } from 'next'
import { Suspense } from 'react'
import { fontVariables } from '@afford/ui/lib/fonts'
import { Providers } from '@/providers'
import { SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Navbar } from '@/components/navbar'
import { source } from '@/lib/source'
import { description, siteUrl } from '@/lib/site-url'
import '@/styles/docs.css'

export const metadata: Metadata = {
  // resolves relative og/twitter image + canonical urls against whichever deployment is serving
  metadataBase: siteUrl,
  openGraph: { siteName: 'Afford docs', type: 'website' },
  title: { default: 'Afford docs', template: '%s · Afford docs' },
  description,
}

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html
    lang="en"
    data-scroll-behavior="smooth"
    className={`${fontVariables} h-full antialiased`}
    suppressHydrationWarning
  >
    <body className="flex min-h-full flex-col text-body">
      <Providers>
        <Navbar />
        <div className="flex flex-1">
          {/* the sidebar is `fixed`, so it's pushed below the navbar explicitly.
              it reads usePathname(), which is only known at request time for urls that weren't prerendered
              (a 404, a probe like /.well-known/…); Suspense lets those stream it in instead of blocking the shell */}
          <Suspense>
            <AppSidebar
              tree={source.pageTree}
              className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
            />
          </Suspense>
          <SidebarInset className="px-4 py-8 md:px-16 md:py-12">{children}</SidebarInset>
        </div>
      </Providers>
    </body>
  </html>
)

export default RootLayout
