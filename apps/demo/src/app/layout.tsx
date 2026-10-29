import type { Metadata } from 'next'
import { fontVariables } from '@affordances/ui/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'Affordances race',
  description: 'A browser agent and an Affordances agent race the same shopping task.',
}

// dark only: it's shown on a projector in a dark room
const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html lang="en" data-theme="dark" className={`${fontVariables} antialiased`}>
    <body className="bg-background text-foreground">{children}</body>
  </html>
)

export default RootLayout
