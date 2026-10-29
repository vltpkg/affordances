import { CodeBlock } from '@afford/ui/components/code-block'
import { benchResults } from '@/lib/bench'

// ponytail: shows each results file as JSON; render a table once the bench's result shape is settled
export const BenchResults = () => {
  const results = benchResults()
  if (!results.length)
    return <p>Results will appear here after the first bench run is committed.</p>
  return results.map(({ file, data }) => (
    <CodeBlock key={file} lang="json" title={file}>
      {JSON.stringify(data, null, 2)}
    </CodeBlock>
  ))
}
