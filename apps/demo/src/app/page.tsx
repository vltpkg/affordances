import { Demo } from '@/components/demo'
import { list } from '@/lib/recordings'

const Page = async ({ searchParams }: PageProps<'/'>) => {
  const { r } = await searchParams
  const recordings = await list()
  return <Demo recordings={recordings} initial={typeof r === 'string' ? r : undefined} />
}

export default Page
