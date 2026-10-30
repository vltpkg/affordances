import { Demo } from '@/components/demo'
import { resolve, type Selection } from '@/lib/catalog'
import { list } from '@/lib/recordings'

// ?story=race&task=add-to-cart&model=opus: a presenter can bookmark the exact race
const Page = async ({ searchParams }: PageProps<'/'>) => {
  const want = (await searchParams) as Partial<Selection>
  const recordings = await list()
  return <Demo recordings={recordings} initial={resolve(recordings, want)} />
}

export default Page
