import type { Metadata } from 'next'
import { ThemeProvider } from '@afford/ui/components/theme-provider'
import { Toaster } from '@afford/ui/components/sonner'
import { fontVariables } from '@afford/ui/lib/fonts'
import { description, siteUrl } from '@/lib/site-url'
import '@/styles/docs.css'

export const metadata: Metadata = {
  // resolves relative og and canonical urls against whichever deployment is serving
  metadataBase: siteUrl,
  title: { default: 'Afford', template: '%s · Afford' },
  description,
  openGraph: { siteName: 'Afford', type: 'website' },
}

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html
    lang="en"
    data-scroll-behavior="smooth"
    className={`${fontVariables} h-full antialiased`}
    suppressHydrationWarning
  >
    <body className="flex min-h-full flex-col text-body [--header-height:3.5rem] [--sidebar-width:16rem]">
      <ThemeProvider>
        {children}
        <Toaster />
      </ThemeProvider>
    </body>
  </html>
)

export default RootLayout
