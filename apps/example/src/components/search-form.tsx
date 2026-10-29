import Form from 'next/form'
import { cn } from 'cn'
import { Input } from '@afford/ui/components/input'

export const SearchForm = ({
  defaultValue,
  className,
}: {
  defaultValue?: string
  className?: string
}) => (
  <search className={cn('w-full sm:w-64', className)}>
    <Form action="/search">
      <label htmlFor="q" className="sr-only">
        Search
      </label>
      <Input
        id="q"
        name="q"
        type="search"
        placeholder="Search the index"
        defaultValue={defaultValue}
        className="h-8"
      />
    </Form>
  </search>
)
