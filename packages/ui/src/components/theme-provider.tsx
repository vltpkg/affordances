'use client'

import { ThemeProvider as NextThemes } from 'next-themes'

// data-theme on <html>, matching the `dark` variant in globals.css; system by default, no visible switcher needed
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => (
  <NextThemes attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
    {children}
  </NextThemes>
)
