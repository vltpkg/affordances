import * as lab from '@affordances/hosting-lab/trial'
import { conditions, type Condition, type ConditionId } from './conditions.ts'
import { createTools } from './tools.ts'
import { setupTrial } from './trial.ts'

// the offer-set preflight (intake, 2026-11-18, ruling 3): a condition must differ from its control only in what it
// declares it manipulates, checked mechanically before any run. Each condition's first view, as the agent's project
// tool returns it, is reduced to its offer ids (choice-set members included) and compared with its control's. The
// control is A, unless the condition declares a scope or start change: then it's A's policy with only the condition's
// scope and depth, and its start, put in. So only the declared change is excused, and anything else that moves the
// offer set (a budget, say) still refuses. The confirmatory audit found C's advocated policy left hosting.plan.list,
// the only source of the plans' allowances, out of C's first view, undeclared

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

// a condition's control: A, or A's policy with only the condition's declared scope and start change
export const controlFor = (condition: Condition): Condition => {
  const scope = condition.manipulates.includes('scope')
  const start = condition.manipulates.includes('start')
  const a = conditions.A
  if (!scope && !start) return a
  return {
    ...a,
    name: `A, with ${condition.id}'s scope`,
    policy: {
      ...a.policy,
      id: `${a.policy.id}--scope-of-${condition.policy.id}`,
      description: `A's policy, with only ${condition.id}'s declared scope change`,
      ...(scope && { scope: condition.policy.scope, depth: condition.policy.depth }),
    },
    ...(start && condition.start !== undefined && { start: condition.start }),
  }
}

export type OfferSetProblem = {
  condition: ConditionId
  control: string
  onlyInControl: string[]
  onlyInCondition: string[]
}

export const offerSetCheck = async (
  ids: ConditionId[],
  task: string,
): Promise<OfferSetProblem[]> => {
  const problems: OfferSetProblem[] = []
  for (const id of ids) {
    const condition = conditions[id]
    const control = controlFor(condition)
    const expected = await firstViewOffers(control, task)
    const offers = await firstViewOffers(condition, task)
    const onlyInControl = expected.filter((o) => !offers.includes(o))
    const onlyInCondition = offers.filter((o) => !expected.includes(o))
    if (onlyInControl.length || onlyInCondition.length)
      problems.push({ condition: id, control: control.policy.id, onlyInControl, onlyInCondition })
  }
  return problems
}
