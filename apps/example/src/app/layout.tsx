import type { Metadata } from 'next'
import { ThemeProvider } from '@afford/ui/components/theme-provider'
import { fontVariables } from '@afford/ui/lib/fonts'
import { AffordDevtools } from '@afford/react/dev'
import { Afford } from '@/components/afford-provider'
import { AgentFrame } from '@/components/agent-view'
import { SiteHeader } from '@/components/site-header'
import '@afford/ui/globals.css'

export const metadata: Metadata = {
  title: { default: 'Afford Supply', template: '%s · Afford Supply' },
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
        <Afford>
          <SiteHeader />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
            <AgentFrame>{children}</AgentFrame>
          </main>
          <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
            Afford Supply is a demo. Nothing ships, and every page can be read and operated by
            agents.
          </footer>
          {process.env.NODE_ENV === 'development' && <AffordDevtools />}
        </Afford>
      </ThemeProvider>
    </body>
  </html>
)

export default RootLayout
