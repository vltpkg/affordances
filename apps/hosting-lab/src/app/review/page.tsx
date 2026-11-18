import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@affordances/ui/components/button'
import { ConfirmationSummary } from '@/components/confirmation'
import { getSessionId } from '@/lib/session'
import { principalFor } from '@/lib/resolvers'
import { REVIEWED, isReviewed, review, type ReviewedAction } from '@/lib/review'
import { currentAccount } from '@/lib/view'
import { addAddOn } from '../add-ons/actions'
import { subscribe, subscribeBundle } from '../plans/actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Review and confirm' }

// the actions a confirm posts: the same ones the pages called before this step existed
const run: Record<ReviewedAction, (form: FormData) => Promise<unknown>> = {
  subscribe,
  subscribeBundle,
  addAddOn,
}

// a purchase's review-and-confirm step: nothing is charged until Confirm. The summary is the runtime's own, the same
// words an agent on the API approves (src/lib/review.ts)
const Page = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) => {
  const params = await searchParams
  const action = params.action
  if (!isReviewed(action)) notFound()
  // the page's own use of the session, as every page makes its account (src/lib/view.ts)
  await currentAccount()
  const r = await review(principalFor(await getSessionId()), action, params)
  const back = REVIEWED[action].back
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Review and confirm</h1>
      {r.summary ? (
        <>
          <ConfirmationSummary summary={r.summary} />
          <div className="flex flex-wrap items-center gap-3">
            <form
              action={async (form: FormData) => {
                'use server'
                await run[action](form)
                redirect(back)
              }}
            >
              {Object.entries(r.input).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <Button type="submit" data-confirm>
                Confirm
              </Button>
            </form>
            <Link href={back} className="text-sm underline">
              Back
            </Link>
          </div>
        </>
      ) : (
        <>
          <p role="alert">This can&apos;t be done now: {r.refused}.</p>
          <Link href={back} className="text-sm underline">
            Back
          </Link>
        </>
      )}
    </div>
  )
}

export default Page
