// no 'use client': in a server component, `action` is the real defineAction function and carries its name
const AFFORD = Symbol.for('afford.action')

export type AffordanceProps = {
  children: React.ReactNode
  // values this control already fixes, e.g. the product it adds
  input?: Record<string, unknown>
} & (
  | { action: (...args: never[]) => unknown; name?: never }
  // in client components a server action arrives as a bare reference, so name it
  | { name: string; action?: never }
)

// marks the element(s) a person would use for an action, for DOM-reading agents and the dev overlay
export const Affordance = ({ action, name, input, children }: AffordanceProps) => {
  const resolved = name ?? (action as { [AFFORD]?: { name: string } } | undefined)?.[AFFORD]?.name
  if (!resolved)
    throw new Error(
      '<Affordance action> needs an action from defineAction, used in a server component. In a client component, pass name="…" instead.',
    )
  return (
    <span
      data-afford-action={resolved}
      data-afford-input={input && JSON.stringify(input)}
      style={{ display: 'contents' }}
    >
      {children}
    </span>
  )
}
