'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { deploy as deployCapability, rollback as rollbackCapability } from '@/manifest'
import deployments from './state'

export const deploy = defineAction({
  capability: deployCapability,
  name: 'deploy',
  state: deployments,
  effects: ['deployments', 'buildMinutes'],
  run: async ({ projectId, ref }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.deploy(sid, projectId, ref)
    revalidatePath('/', 'layout')
    return result
  },
  message: ({ output }) => `Deployment ${output.id} is ${output.status}`,
})

export const rollback = defineAction({
  capability: rollbackCapability,
  name: 'rollback',
  state: deployments,
  effects: ['deployments'],
  // the checks only the application can make: the plan is on the project, which a deployment doesn't hold
  guards: {
    planHasRollback: ({ ctx }) => {
      const { project } = store.account(ctx.session?.id ?? 'anonymous-preview')
      const plan = store.planBySlug(project.plan)
      return plan.rollback || `${plan.name} doesn't include rollback`
    },
    owns: ({ input, ctx }) =>
      !input ||
      store
        .account(ctx.session?.id ?? 'anonymous-preview')
        .project.deployments.some((d) => d.id === input.deployment) ||
      `No deployment ${input.deployment}`,
  },
  run: async ({ deployment }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.rollback(sid, deployment)
    revalidatePath('/', 'layout')
    return result
  },
  message: ({ output }) => `${output.current} is published again`,
})
