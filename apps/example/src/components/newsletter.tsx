'use client'

import { useState } from 'react'
import { Button } from '@affordances/ui/components/button'
import { Input } from '@affordances/ui/components/input'

// nothing sends mail in the demo, so a signup only thanks the person
export const Newsletter = () => {
  const [done, setDone] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setDone(true)
      }}
      className="mt-4"
    >
      <label htmlFor="newsletter-email" className="sr-only">
        Email
      </label>
      <div className="flex gap-2">
        <Input
          id="newsletter-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={done}
          className="h-8"
        />
        <Button type="submit" variant="outline" size="lg" disabled={done}>
          Subscribe
        </Button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-muted-foreground">
        {done && 'Thanks. You’ll hear from us when the next run is ready.'}
      </p>
    </form>
  )
}
