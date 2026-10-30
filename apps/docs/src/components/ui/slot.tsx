import { Children, cloneElement, isValidElement } from 'react'
import { cn } from 'cn'

type AnyProps = Record<string, unknown> & { className?: string }

// radix's Slot, as much of it as this site uses: the one child element receives the props, classes merge,
// and the child's own handlers run before the slot's
export const Slot = ({ children, ...props }: AnyProps & { children?: React.ReactNode }) => {
  const child = Children.only(children)
  if (!isValidElement<AnyProps>(child)) return null
  const merged: AnyProps = { ...props, ...child.props }
  for (const key of Object.keys(props))
    if (
      /^on[A-Z]/.test(key) &&
      typeof props[key] === 'function' &&
      typeof child.props[key] === 'function'
    ) {
      const own = child.props[key] as (...args: unknown[]) => void
      const slot = props[key] as (...args: unknown[]) => void
      merged[key] = (...args: unknown[]) => {
        own(...args)
        slot(...args)
      }
    }
  merged.className = cn(props.className, child.props.className)
  return cloneElement(child, merged)
}
