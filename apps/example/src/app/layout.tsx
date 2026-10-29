import type { Metadata } from 'next'
import { ThemeProvider } from '@affordances/ui/components/theme-provider'
import { fontVariables } from '@affordances/ui/lib/fonts'
import { AffordancesDevtools } from '@affordances/react/dev'
import { Affordances } from '@/components/affordances-provider'
import { AgentFrame } from '@/components/agent-view'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import '@affordances/ui/globals.css'

export const metadata: Metadata = {
  title: { default: 'Acme Store', template: '%s · Acme Store' },
  description: 'Studio goods in small runs. A demo store that agents can operate.',
}

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html
    lang="en"
    data-scroll-behavior="smooth"
    className={`${fontVariables} h-full antialiased`}
    suppressHydrationWarning
  >
    <body className="text-body flex min-h-full flex-col">
      <ThemeProvider>
        <Affordances>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-20 sm:px-6 sm:pt-8">
            <AgentFrame>{children}</AgentFrame>
          </main>
          <SiteFooter />
          {process.env.NODE_ENV === 'development' && <AffordancesDevtools />}
        </Affordances>
      </ThemeProvider>
    </body>
  </html>
)

export default RootLayout
