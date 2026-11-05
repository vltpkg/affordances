import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { fontVariables } from '@affordances/ui/lib/fonts'
import { Providers } from '@/providers'
import { description, siteUrl } from '@/lib/site-url'
import { prePaintScript } from '@/lib/package-managers'
import '@/styles/docs.css'

export const metadata: Metadata = {
  // resolves relative og/twitter image + canonical urls against whichever deployment is serving
  metadataBase: siteUrl,
  openGraph: { siteName: 'Affordances', type: 'website' },
  title: { default: 'Affordances', template: '%s · Affordances' },
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
    <head>
      {/* every command shows the reader's package manager from the first paint, and pages stay static */}
      <script dangerouslySetInnerHTML={{ __html: prePaintScript }} />
    </head>
    <body className="flex min-h-full flex-col text-body">
      <Providers>{children}</Providers>
      <Analytics />
    </body>
  </html>
)

export default RootLayout
