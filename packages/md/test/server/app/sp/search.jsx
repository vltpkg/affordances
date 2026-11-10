'use client'
import { useSearchParams } from 'next/navigation'

export function Search() {
  return <p>Searching for {useSearchParams().get('q')}</p>
}
