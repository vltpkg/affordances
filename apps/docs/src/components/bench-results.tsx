import { CodeBlock } from '@afford/ui/components/code-block'
import { benchResults } from '@/lib/bench'

// ponytail: shows each results file as JSON; render a table once the bench's result shape is settled
export const BenchResults = () => {
  const results = benchResults()
  if (!results.length)
    return <p>Results will appear here after the first bench run is committed.</p>
  // every row, without its per-call trace: traces are most of a file and pushed this page past the markdown
  // converter's size limit. they stay in the committed files
  return results.map(({ file, data }) => (
    <CodeBlock key={file} lang="json" title={file}>
      {JSON.stringify(data, (key, value) => (key === 'trace' ? undefined : value), 2)}
    </CodeBlock>
  ))
}
