'use client'
import dynamic from 'next/dynamic'

// rendered in the browser only, by design: react writes the boundary as client-rendered
export const Lazy = dynamic(() => import('./chart'), { ssr: false })
