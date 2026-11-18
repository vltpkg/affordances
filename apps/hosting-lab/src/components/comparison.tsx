import type { InspectedOffer, Inspection } from '@/lib/inspect'

const json = (value: unknown) => JSON.stringify(value)

export type InspectedSet = Inspection['choiceSets'][number]

// a cell as text: an object or array whole, by JSON (RFC 0002 §6.6 compares cells whole), anything else as written
const cell = (value: unknown) =>
  value !== null && typeof value === 'object' ? json(value) : String(value)

// RFC 0002 §6.6's comparison: every member, every attribute on which they differ, the shared ones once, and what the
// request's facts limit cut, named. The same table an agent's view carries, under every policy
export const ChoiceSetComparison = ({
  set,
  offers,
  policy,
}: {
  set: InspectedSet
  offers: InspectedOffer[]
  policy: string
}) => {
  const comparison = set.comparison
  const keyOf = (member: string) => offers.find((o) => o.id === member)?.target?.key ?? member
  const unsupplied = (member: string, attribute: string) =>
    comparison?.unsupplied.some((u) => u.member === member && u.attributes.includes(attribute))
  return (
    <div className={`flex flex-col gap-2 ${set.inView ? '' : 'opacity-80'}`}>
      <p>
        <code>{set.id}</code> over {set.over}, ordered <code>{json(set.order)}</code>
        {!set.inView && ` · omitted by ${policy}; its comparison, one expansion away:`}
      </p>
      {comparison ? (
        <div className="overflow-x-auto">
          <table className="border-collapse text-left">
            <caption className="text-muted-foreground mb-1 text-left text-xs">
              {set.members.length} members, compared on {comparison.differ.length} attributes
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="bg-background sticky left-0 py-1 pr-3">
                  Member
                </th>
                {comparison.differ.map((a) => (
                  <th key={a} scope="col" className="py-1 pr-3">
                    {a}
                    {set.marks.cited.includes(a) && (
                      <span className="text-muted-foreground ml-1 text-xs">· cited</span>
                    )}
                    {set.marks.read.includes(a) && (
                      <span className="text-muted-foreground ml-1 text-xs">· read</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {set.members.map((member, n) => (
                <tr key={member} className="border-b align-top">
                  <th scope="row" className="bg-background sticky left-0 py-1 pr-3 font-normal">
                    <code>{keyOf(member)}</code>
                  </th>
                  {comparison.differ.map((a) =>
                    unsupplied(member, a) ? (
                      <td
                        key={a}
                        className="text-muted-foreground py-1 pr-3"
                        aria-label={`${a} not supplied`}
                      >
                        not supplied
                      </td>
                    ) : (
                      <td key={a} className="py-1 pr-3">
                        {cell(comparison.rows[n]?.[a])}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground">No comparison came back for this set.</p>
      )}
      {comparison && Object.keys(comparison.shared).length > 0 && (
        <p>
          Same for every member:{' '}
          {Object.entries(comparison.shared)
            .map(([a, v]) => `${a} ${cell(v)}`)
            .join(', ')}
        </p>
      )}
      {comparison && comparison.omitted.attributes.length > 0 && (
        <p>
          Cut by the request&apos;s facts limit: {comparison.omitted.attributes.join(', ')}.
          Expanding the set along <code>comparison</code> returns them.
        </p>
      )}
    </div>
  )
}
