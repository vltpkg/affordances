'use client'

import { useSyncExternalStore } from 'react'

export const useTextSelection = () =>
  useSyncExternalStore(
    (onChange) => {
      document.addEventListener('selectionchange', onChange)
      return () => document.removeEventListener('selectionchange', onChange)
    },
    () => getSelection()?.toString() ?? '',
    () => '',
  )
