'use client'

import { LinkIcon } from 'lucide-react'
import { useCopy } from '@afford/ui/hooks/use-copy'

type HeadingProps = React.ComponentProps<'h2'> & { as: 'h2' | 'h3' | 'h4' }

// article headings link to themselves: clicking jumps to the anchor and copies the full url
export const Heading = ({ as: Tag, id, children, ...props }: HeadingProps) => {
  const { copy } = useCopy()
  if (!id) return <Tag {...props}>{children}</Tag>

  return (
    <Tag id={id} {...props}>
      <a
        href={`#${id}`}
        onClick={() => copy(`${location.origin}${location.pathname}#${id}`)}
        // typeset underlines links; a heading shouldn't look like one
        className="group/anchor inline text-inherit! no-underline! decoration-transparent"
      >
        {children}
        <LinkIcon
          aria-hidden
          className="ml-2 inline size-[0.7em] align-baseline text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/anchor:opacity-100 group-focus-visible/anchor:opacity-100 motion-reduce:transition-none"
        />
      </a>
    </Tag>
  )
}
