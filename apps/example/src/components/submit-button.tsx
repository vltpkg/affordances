'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@affordances/ui/components/button'

// disabled while its form's action runs, so a double click doesn't submit twice
export const SubmitButton = ({ disabled, ...props }: React.ComponentProps<typeof Button>) => {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    />
  )
}
