import * as lab from '@affordances/hosting-lab/trial'
import { conditions, type Condition, type ConditionId } from './conditions.ts'
import { createTools } from './tools.ts'
import { setupTrial } from './trial.ts'

// the offer-set preflight (intake, 2026-11-18, ruling 3): a condition must differ from its control, A, only in what it
// declares it manipulates, checked mechanically before any run. Each condition's first view, as the agent's project
// tool returns it, is reduced to its offer ids (choice-set members included) and compared with A's. Scope and start
// change the offer set by design; anything else that changes it refuses. The confirmatory audit found C's advocated
// policy left hosting.plan.list, the only source of the plans' allowances, out of C's first view, undeclared

type ViewJson = {
  offers: { id: string }[]
  choiceSets: { id: string; members: (string | { id: string })[] }[]
}

export const firstViewOffers = async (condition: Condition, task: string, index = 0) => {
  const t = lab.tasks.find((x) => x.id === task)
  if (!t) throw new Error(`no task ${task}`)
  const trial = await setupTrial(condition, index, task)
  const view = JSON.parse((await createTools(trial, condition, t).call('project')).text) as ViewJson
  // the trial's project key varies by run; the offer set is compared without it
  const ids = [
    ...view.offers.map((o) => o.id),
    ...view.choiceSets.flatMap((c) => [
      c.id,
      ...c.members.map((m) => (typeof m === 'string' ? m : m.id)),
    ]),
  ].map((id) => id.replaceAll(trial.project.key, '{project}'))
  return [...new Set(ids)].toSorted()
}

export type OfferSetProblem = {
  condition: ConditionId
  onlyInA: string[]
  onlyInCondition: string[]
}

export const offerSetCheck = async (
  ids: ConditionId[],
  task: string,
): Promise<OfferSetProblem[]> => {
  const control = await firstViewOffers(conditions.A, task)
  const problems: OfferSetProblem[] = []
  for (const id of ids) {
    const condition = conditions[id]
    if (condition.manipulates.includes('scope') || condition.manipulates.includes('start')) continue
    const offers = await firstViewOffers(condition, task)
    const onlyInA = control.filter((o) => !offers.includes(o))
    const onlyInCondition = offers.filter((o) => !control.includes(o))
    if (onlyInA.length || onlyInCondition.length)
      problems.push({ condition: id, onlyInA, onlyInCondition })
  }
  return problems
}
