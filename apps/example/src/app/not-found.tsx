import Link from 'next/link'

const NotFound = () => (
  <>
    <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
    <p className="mt-2 text-muted-foreground">
      There is nothing at this address.{' '}
      <Link href="/" className="text-foreground underline underline-offset-4">
        Back to the index
      </Link>
    </p>
  </>
)

export default NotFound
