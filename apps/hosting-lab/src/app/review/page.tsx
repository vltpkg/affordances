import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Button } from '@affordances/ui/components/button'
import { ConfirmationSummary } from '@/components/confirmation'
import { getSessionId } from '@/lib/session'
import { principalFor } from '@/lib/resolvers'
import {
  NOT_CONFIRMED,
  REVIEWED,
  confirmReviewed,
  isNotConfirmed,
  isReviewed,
  review,
  type ReviewedAction,
} from '@/lib/review'
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
  // a Confirm that didn't purchase comes back here, with only its code: the page says why, beside a fresh review
  const notConfirmed = isNotConfirmed(params.notConfirmed) ? params.notConfirmed : undefined
  // a string, not URLSearchParams: the Confirm's server action closes over it, and Next serializes what it closes
  // over, which keeps a string and not that object
  const here = new URLSearchParams({ action, ...r.input }).toString()
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Review and confirm</h1>
      {notConfirmed && (
        <p role="alert" data-not-confirmed={notConfirmed} className="font-medium">
          {NOT_CONFIRMED[notConfirmed]}
        </p>
      )}
      {r.summary ? (
        <>
          <ConfirmationSummary summary={r.summary} />
          <div className="flex flex-wrap items-center gap-3">
            <form
              action={async (form: FormData) => {
                'use server'
                // checked again, and run only if the summary is still the one shown; a refusal is answered here, as
                // an ordinary page, never thrown as a 500
                const outcome = await confirmReviewed(
                  principalFor(await getSessionId()),
                  action,
                  form,
                  run[action],
                )
                redirect(outcome === 'confirmed' ? back : `/review?${here}&notConfirmed=${outcome}`)
              }}
            >
              {Object.entries(r.input).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <input type="hidden" name="seen" value={r.summary} />
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
