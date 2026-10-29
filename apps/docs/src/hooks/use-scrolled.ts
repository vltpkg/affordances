'use client'

import { useSyncExternalStore } from 'react'

export const useScrolled = (threshold = 300) =>
  useSyncExternalStore(
    (onChange) => {
      addEventListener('scroll', onChange, { passive: true })
      return () => removeEventListener('scroll', onChange)
    },
    () => scrollY > threshold,
    () => false,
  )
