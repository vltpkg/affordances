'use server'

import { revalidatePath } from 'next/cache'
import { defineAction } from '@/lib/affordances'
import { messages } from '@/lib/messages'
import { checkedBy } from '@/lib/runtime'
import { ownsDeployment, planHasRollback } from '@/lib/guards'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import { deploy as deployCapability, rollback as rollbackCapability } from '@/app/capabilities'
import deployments from './state'

export const deploy = defineAction({
  capability: deployCapability,
  name: 'deploy',
  ...checkedBy,
  state: deployments,
  effects: ['deployments', 'buildMinutes'],
  run: async ({ projectId, ref }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.deploy(store.account(sid).id, projectId, ref)
    revalidatePath('/', 'layout')
    return result
  },
  message: messages.deployed,
})

export const rollback = defineAction({
  capability: rollbackCapability,
  name: 'rollback',
  ...checkedBy,
  state: deployments,
  effects: ['deployments'],
  // the same checks the runtime's handlers make (src/lib/guards.ts)
  guards: {
    planHasRollback: ({ ctx }) =>
      planHasRollback(ctx.session ? store.findAccount(ctx.session.id) : undefined),
    owns: ({ input, ctx }) =>
      ownsDeployment(
        ctx.session ? store.findAccount(ctx.session.id) : undefined,
        input?.deployment,
      ),
  },
  run: async ({ deployment }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.rollback(store.account(sid).id, deployment)
    revalidatePath('/', 'layout')
    return result
  },
  message: messages.rolledBack,
})
