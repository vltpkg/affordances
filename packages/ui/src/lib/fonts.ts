import { Geist, Geist_Mono, Geist_Pixel } from 'next/font/google'

export const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

export const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// display face for accents (wordmark, breadcrumbs, agent-view labels); `font-pixel` in tailwind
export const geistPixel = Geist_Pixel({
  variable: '--font-geist-pixel',
  subsets: ['latin'],
  // next has no metrics for this face, so an explicit fallback stops turbopack trying (and warning) to size one
  fallback: ['monospace'],
})

export const fontVariables = `${geistSans.variable} ${geistMono.variable} ${geistPixel.variable}`
