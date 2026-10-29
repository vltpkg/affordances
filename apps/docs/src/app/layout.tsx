import type { Metadata } from 'next'
import { fontVariables } from '@afford/ui/lib/fonts'
import { Providers } from '@/providers'
import { description, siteUrl } from '@/lib/site-url'
import '@/styles/docs.css'

export const metadata: Metadata = {
  // resolves relative og/twitter image + canonical urls against whichever deployment is serving
  metadataBase: siteUrl,
  openGraph: { siteName: 'Afford', type: 'website' },
  title: { default: 'Afford', template: '%s · Afford' },
  description,
}

// html, fonts, theme, and toasts; the marketing page and the docs each bring their own shell
const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html
    lang="en"
    data-scroll-behavior="smooth"
    className={`${fontVariables} h-full antialiased`}
    suppressHydrationWarning
  >
    <body className="flex min-h-full flex-col text-body">
      <Providers>{children}</Providers>
    </body>
  </html>
)

export default RootLayout
