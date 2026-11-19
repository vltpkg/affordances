import Link from 'next/link'
import { notFound } from 'next/navigation'
import { inspectorEnabled } from '@/lib/gate'
import { getSessionId } from '@/lib/session'
import { ChoiceSetComparison } from '@/components/comparison'
import { POLICIES, inspect, type InspectedOffer } from '@/lib/inspect'
import { principalFor } from '@/lib/resolvers'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inspector' }

// a developer view of the manifest and a projection for you (roadmap M3f). It shows every offer you may see, and
// marks the ones the chosen policy's view leaves out

const json = (value: unknown) => JSON.stringify(value)

const Status = ({ offer }: { offer: InspectedOffer }) => {
  const a = offer.availability
  return (
    <span>
      {a.status}
      {'because' in a && a.because.length > 0 && ` (${a.because.join(', ')})`}
      {'inputs' in a && ` (${a.inputs.join(', ')})`}
    </span>
  )
}

const Page = async ({ searchParams }: PageProps<'/inspect'>) => {
  // the proxy refuses it first; this is the page's own check, in case a deployment runs without the proxy
  if (!inspectorEnabled()) notFound()
  const params = await searchParams
  const requested = params.policy
  const policy =
    typeof requested === 'string' && POLICIES.includes(requested) ? requested : 'exhaustive'
  // a request's facts limit, in cells (RFC 0002 §6.6): only a request's own can cut a comparison, so the inspector
  // takes one to show the cut
  const facts =
    typeof params.facts === 'string' && /^\d+$/.test(params.facts)
      ? Number(params.facts)
      : undefined
  const i = await inspect(principalFor(await getSessionId()), { policy, facts })
  const omitted = i.offers.filter((o) => !o.inView)
  return (
    <div className="flex flex-col gap-10 text-sm">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Inspector</h1>
        <p className="text-muted-foreground">
          The manifest, and a projection for you, at revision{' '}
          <code>{i.revision.slice(0, 19)}…</code>. It shows every offer you may see. Offers the{' '}
          {i.policy} policy&apos;s view leaves out are marked.
        </p>
        <nav aria-label="Policy" className="flex flex-wrap gap-3">
          {POLICIES.map((p) => (
            <Link
              key={p}
              href={`/inspect?policy=${p}${facts === undefined ? '' : `&facts=${facts}`}`}
              aria-current={p === i.policy ? 'page' : undefined}
              className={p === i.policy ? 'font-medium underline' : 'text-muted-foreground'}
            >
              {p}
            </Link>
          ))}
        </nav>
        <form method="get" action="/inspect" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="policy" value={i.policy} />
          <label htmlFor="facts">Facts limit, in cells</label>
          <input
            id="facts"
            name="facts"
            type="number"
            min={0}
            defaultValue={facts}
            placeholder="none"
            className="w-24 rounded border px-2 py-1"
          />
          <button type="submit" className="rounded border px-2 py-1">
            Apply
          </button>
        </form>
        <p>
          View order: <code>{json(i.order)}</code>. In view: {i.offers.length - omitted.length} of{' '}
          {i.offers.length} offers. Omitted, as the view counts them: {json(i.omitted)}.
        </p>
      </header>

      <section aria-labelledby="offers" className="flex flex-col gap-3">
        <h2 id="offers" className="text-lg font-medium">
          Offers
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-3">Offer</th>
                <th className="py-1 pr-3">Availability</th>
                <th className="py-1 pr-3">Conditions</th>
                <th className="py-1 pr-3">Requirements</th>
                <th className="py-1 pr-3">Claims</th>
                <th className="py-1">In view</th>
              </tr>
            </thead>
            <tbody>
              {i.offers.map((o) => (
                <tr key={o.id} className={`border-b align-top ${o.inView ? '' : 'opacity-60'}`}>
                  <td className="py-1 pr-3">
                    <code>{o.id}</code>
                    {o.consequential && <span className="ml-1 text-xs">· consequential</span>}
                    {o.choiceSet && (
                      <div className="text-xs text-muted-foreground">choice set {o.choiceSet}</div>
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    <Status offer={o} />
                  </td>
                  <td className="py-1 pr-3">
                    {o.conditions.map((c) => (
                      <div key={c.id}>
                        {c.id}: {String(c.value)}
                        {c.detail && ` (${c.detail})`}
                      </div>
                    ))}
                  </td>
                  <td className="py-1 pr-3">
                    authorization {o.requirements.authorization}
                    {o.requirements.confirmation && (
                      <div>confirm: {o.requirements.confirmation.summary}</div>
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    {o.claims.map((c) => (
                      <div key={c.id}>
                        {c.kind}: {c.statement}{' '}
                        <span className="text-xs text-muted-foreground">
                          ({c.source.name}, {c.basis})
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="py-1">{o.inView ? 'yes' : `omitted by ${i.policy}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="choices" className="flex flex-col gap-4">
        <h2 id="choices" className="text-lg font-medium">
          Choice sets
        </h2>
        {i.choiceSets.map((c) => (
          <ChoiceSetComparison key={c.id} set={c} offers={i.offers} policy={i.policy} />
        ))}
      </section>

      <section aria-labelledby="definitions" className="flex flex-col gap-3">
        <h2 id="definitions" className="text-lg font-medium">
          Capabilities
        </h2>
        {i.definitions.capabilities.map((c) => (
          <details key={c.id} className="rounded-md border p-3">
            <summary>
              <code>{c.id}</code> · {c.kind} · {c.description}
            </summary>
            <dl className="mt-2 grid grid-cols-[10rem_1fr] gap-y-1">
              <dt className="text-muted-foreground">Target</dt>
              <dd>
                {c.target ?? 'none'}
                {c.targetAt && ` at ${c.targetAt}`}
              </dd>
              <dt className="text-muted-foreground">Conditions</dt>
              <dd>
                {[...(c.authorization?.conditions ?? []), ...(c.preconditions ?? [])].map((p) => (
                  <div key={p.id}>
                    {p.id}: {p.description} · {'guard' in p ? 'guard' : <code>{json(p.expr)}</code>}
                  </div>
                ))}
              </dd>
              <dt className="text-muted-foreground">Effects</dt>
              <dd>
                {(c.effects ?? []).map((e) => (
                  <div key={e.description}>
                    {e.category}, {e.reversibility ?? 'unknown'}: {e.description}
                  </div>
                ))}
              </dd>
              <dt className="text-muted-foreground">Provenance</dt>
              <dd>
                {json(c.provenance ?? 'the manifest default')}
                {c.fieldProvenance && (
                  <div className="text-muted-foreground">fields: {json(c.fieldProvenance)}</div>
                )}
              </dd>
            </dl>
          </details>
        ))}
      </section>

      <section aria-labelledby="relations" className="flex flex-col gap-2">
        <h2 id="relations" className="text-lg font-medium">
          Relations
        </h2>
        {i.definitions.relations.map((r) => (
          <p key={`${r.type}${r.from}${r.to}`}>
            {r.from} {r.type} {r.to} · declared
          </p>
        ))}
        {i.definitions.derived.map((e) => (
          <p key={`${e.relation}${e.from}${e.to}`} className="text-muted-foreground">
            {e.from} {e.relation} {e.to} · {e.basis}, from {e.via.join(', ')}
          </p>
        ))}
      </section>
    </div>
  )
}

export default Page
