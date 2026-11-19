'use server'

// RFC 0005 §7's v0 rewrite of apps/hosting-lab/src/app/deployments/actions.ts, by SCORING.md §3's rules. SPIKE:
// measurement input
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { messages } from '@/lib/messages'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import deployments from './state'

export const deploy = defineAction({
  name: 'deploy',
  description:
    "Build the project from a git ref, and publish it at the project's address when the build succeeds. Uses build minutes",
  input: z.object({ projectId: z.string(), ref: z.string().min(1) }),
  expose: 'session',
  requires: "The plan's build minutes for this month aren't used up",
  guard: () => true,
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
  name: 'rollback',
  description:
    'Publish this earlier deployment again, in place of the current one. Needs a plan with rollback',
  input: z.object({ deployment: z.string() }),
  expose: 'session',
  requires:
    "The deployment built successfully, and It isn't the published deployment already, and The project's plan includes rollback, and You own the project",
  guard: () => true,
  state: deployments,
  effects: ['deployments'],
  run: async ({ deployment }, ctx) => {
    const sid = ctx.session?.id ?? (await ensureSession())
    const result = store.rollback(store.account(sid).id, deployment)
    revalidatePath('/', 'layout')
    return result
  },
  message: messages.rolledBack,
})
