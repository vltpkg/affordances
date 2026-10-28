import type { Metadata } from 'next'
import { ThemeProvider } from '@afford/ui/components/theme-provider'
import { fontVariables } from '@afford/ui/lib/fonts'
import '@afford/ui/globals.css'

export const metadata: Metadata = {
  title: 'Afford Supply',
}

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html lang="en" className={`${fontVariables} h-full antialiased`} suppressHydrationWarning>
    <body className="text-body min-h-full">
      <ThemeProvider>{children}</ThemeProvider>
    </body>
  </html>
)

export default RootLayout
