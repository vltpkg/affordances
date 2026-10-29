'use client'

import { useSyncExternalStore } from 'react'

// false on the server and during hydration, then the live match
export const useMedia = (query: string) =>
  useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
