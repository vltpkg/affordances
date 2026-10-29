import Form from 'next/form'
import { cn } from 'cn'
import { Input } from '@affordances/ui/components/input'

// the header and the search page each carry one, so the id is theirs to pick
export const SearchForm = ({
  id = 'q',
  defaultValue,
  className,
}: {
  id?: string
  defaultValue?: string
  className?: string
}) => (
  <search className={cn('w-full sm:w-64', className)}>
    <Form action="/search">
      <label htmlFor={id} className="sr-only">
        Search
      </label>
      <Input
        id={id}
        name="q"
        type="search"
        placeholder="Search products"
        defaultValue={defaultValue}
        className="h-8"
      />
    </Form>
  </search>
)
