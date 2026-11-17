import { z } from 'zod'
import {
  defineCapability,
  defineClaims,
  defineManifest,
  definePrincipal,
  defineResource,
  guard,
  when,
} from '@affordances/ir'

// the hosting provider's capabilities, as data (RFC 0001 §12.1). Every effect is declared as it really happens: what
// it charges, whether that can be undone, and what it publishes. The benchmark holds these fixed and varies only how
// they're disclosed

const owner = definePrincipal({
  description: 'A signed-in account',
  attributes: z.object({ id: z.string() }),
})

// ---- resources ----

export const project = defineResource({
  id: 'hosting.project',
  description: 'A project: one site or app, on one plan',
  key: 'id',
  attributes: z.object({
    id: z.string(),
    ownerId: z.string(),
    plan: z.enum(['hobby', 'pro', 'business']),
    addOns: z.array(z.string()),
    buildMinutesUsed: z.number().int(), // this month
    buildMinutesIncluded: z.number().int(), // this month, from the plan
  }),
})

export const plan = defineResource({
  id: 'hosting.plan',
  description: 'A plan: what a project gets each month, and what it costs',
  key: 'slug',
  attributes: z.object({
    slug: z.enum(['hobby', 'pro', 'business']),
    name: z.string(),
    priceUsd: z.number(),
    buildMinutes: z.number().int(),
    bandwidthGb: z.number().int(),
    rollback: z.boolean(),
    support: z.enum(['community', 'email', 'priority']),
  }),
  // a project is on exactly one plan: subscribing to one is a choice among all of them
  alternatives: true,
})

export const addOn = defineResource({
  id: 'hosting.addOn',
  description: 'An add-on a project can have on top of its plan, billed monthly',
  key: 'slug',
  attributes: z.object({ slug: z.string(), name: z.string(), priceUsd: z.number() }),
})

export const bundle = defineResource({
  id: 'hosting.bundle',
  description: 'A plan and add-ons together, for one monthly price',
  key: 'slug',
  attributes: z.object({
    slug: z.string(),
    name: z.string(),
    plan: z.enum(['hobby', 'pro', 'business']),
    addOns: z.array(z.string()),
    priceUsd: z.number(),
  }),
})

export const deployment = defineResource({
  id: 'hosting.deployment',
  description: "One build of a project, published at the project's address when it's ready",
  key: 'id',
  attributes: z.object({
    id: z.string(),
    projectId: z.string(),
    status: z.enum(['building', 'ready', 'failed', 'rolledBack']),
    current: z.boolean(),
  }),
})

// ---- what an agent can read ----

export const listPlans = defineCapability({
  id: 'hosting.plan.list',
  kind: 'query',
  description: 'List every plan, with its price, limits, rollback and support',
  output: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      priceUsd: z.number(),
      buildMinutes: z.number(),
      bandwidthGb: z.number(),
      rollback: z.boolean(),
      support: z.string(),
    }),
  ),
  authorization: { principal: 'any' },
})

export const readProject = defineCapability({
  id: 'hosting.project.read',
  kind: 'query',
  description: "Read a project: its plan, add-ons and this month's build minutes",
  target: project,
  principal: owner,
  authorization: {
    principal: 'authenticated',
    conditions: {
      owns: when.eq('target.ownerId', when.path('principal.id')).because('You own the project'),
    },
  },
})

// ---- plans ----

const onProject = z.object({ projectId: z.string() })

export const cancel = defineCapability({
  id: 'hosting.subscription.cancel',
  kind: 'action',
  description:
    "Move the project back to Hobby at the end of the month. Stops the paid plan's renewal; nothing already charged is refunded",
  target: project,
  principal: owner,
  idempotent: true,
  authorization: {
    principal: 'authenticated',
    conditions: {
      owns: when.eq('target.ownerId', when.path('principal.id')).because('You own the project'),
    },
  },
  preconditions: {
    paid: when.ne('target.plan', 'hobby').because('The project is on a paid plan'),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: project,
      description: 'Moves the project to Hobby at the end of the month',
      establishes: when.eq('target.plan', 'hobby'),
      reversibility: 'reversible',
    },
  ],
})

export const subscribe = defineCapability({
  id: 'hosting.plan.subscribe',
  kind: 'action',
  description:
    "Move a project to this plan. Charges the plan's price now, then every month until cancelled",
  target: plan,
  input: onProject,
  references: { project: { resource: project, at: 'projectId' } },
  principal: owner,
  authorization: { principal: 'authenticated' },
  confirmation: {
    summary: 'Move {project.id} to {target.name}, for {target.priceUsd} USD a month',
  },
  preconditions: {
    owns: when.eq('project.ownerId', when.path('principal.id')).because('You own the project'),
    notCurrent: when
      .ne('project.plan', when.path('target.slug'))
      .because("The project isn't already on this plan"),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: project,
      description: "Changes the project's plan, and its limits with it",
      reversibility: 'reversible',
    },
    {
      category: 'financial',
      description: "Charges the first month's price now. It isn't refunded",
      reversibility: 'irreversible',
    },
    {
      category: 'financial',
      description: "Renews at the plan's price every month",
      reversibility: 'compensable',
      compensatedBy: cancel,
    },
  ],
})

export const subscribeBundle = defineCapability({
  id: 'hosting.bundle.subscribe',
  kind: 'action',
  description:
    "Move a project to the bundle's plan with its add-ons, for the bundle's one monthly price. Charges it now, then every month until cancelled",
  target: bundle,
  input: onProject,
  references: { project: { resource: project, at: 'projectId' } },
  principal: owner,
  authorization: { principal: 'authenticated' },
  confirmation: {
    summary: 'Move {project.id} to {target.name}, for {target.priceUsd} USD a month',
  },
  preconditions: {
    owns: when.eq('project.ownerId', when.path('principal.id')).because('You own the project'),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: project,
      description: "Changes the project's plan, and adds the bundle's add-ons",
      reversibility: 'reversible',
    },
    {
      category: 'financial',
      description: "Charges the first month's price now. It isn't refunded",
      reversibility: 'irreversible',
    },
    {
      category: 'financial',
      description: "Renews at the bundle's price every month",
      reversibility: 'compensable',
      compensatedBy: cancel,
    },
  ],
})

// ---- add-ons ----

const withAddOn = z.object({ addOn: z.string() })

export const removeAddOn = defineCapability({
  id: 'hosting.addOn.remove',
  kind: 'action',
  description: 'Remove an add-on at the end of the month. Nothing already charged is refunded',
  target: project,
  input: withAddOn,
  references: { addOn: { resource: addOn, at: 'addOn' } },
  principal: owner,
  idempotent: true,
  authorization: {
    principal: 'authenticated',
    conditions: {
      owns: when.eq('target.ownerId', when.path('principal.id')).because('You own the project'),
    },
  },
  preconditions: {
    has: when.in('addOn.slug', when.path('target.addOns')).because('The project has this add-on'),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: project,
      description: 'Removes the add-on at the end of the month',
      reversibility: 'reversible',
    },
  ],
})

export const addAddOn = defineCapability({
  id: 'hosting.addOn.add',
  kind: 'action',
  description:
    "Add an add-on to a project. Charges its price now, then every month until it's removed",
  target: project,
  input: withAddOn,
  references: { addOn: { resource: addOn, at: 'addOn' } },
  principal: owner,
  authorization: {
    principal: 'authenticated',
    conditions: {
      owns: when.eq('target.ownerId', when.path('principal.id')).because('You own the project'),
    },
  },
  confirmation: { summary: 'Add {addOn.name} to {target.id}, for {addOn.priceUsd} USD a month' },
  preconditions: {
    notAdded: when
      .not(when.in('addOn.slug', when.path('target.addOns')))
      .because("The project doesn't have it yet"),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: project,
      // what it establishes names the add-on, and an effect's expression reads only the target, so it isn't stated
      description: 'Adds the add-on to the project',
      reversibility: 'reversible',
    },
    {
      category: 'financial',
      description: "Charges the first month's price now. It isn't refunded",
      reversibility: 'irreversible',
    },
    {
      category: 'financial',
      description: "Renews at the add-on's price every month",
      reversibility: 'compensable',
      compensatedBy: removeAddOn,
    },
  ],
})

// ---- deploying ----

export const rollback = defineCapability({
  id: 'hosting.deployment.rollback',
  kind: 'action',
  description:
    'Publish this earlier deployment again, in place of the current one. Needs a plan with rollback',
  target: deployment,
  principal: owner,
  idempotent: true,
  authorization: { principal: 'authenticated' },
  preconditions: {
    ready: when.eq('target.status', 'ready').because('The deployment built successfully'),
    notCurrent: when
      .eq('target.current', false)
      .because("It isn't the published deployment already"),
    // the plan is on the project, which a deployment doesn't hold: the application checks it
    planHasRollback: guard("The project's plan includes rollback"),
    owns: guard('You own the project'),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: deployment,
      description: 'Makes this deployment the published one',
      establishes: when.eq('target.current', true),
      reversibility: 'reversible',
    },
    {
      category: 'external',
      description: "Changes what visitors see at the project's address",
      reversibility: 'reversible',
    },
  ],
})

export const deploy = defineCapability({
  id: 'hosting.deployment.create',
  kind: 'action',
  description:
    "Build the project from a git ref, and publish it at the project's address when the build succeeds. Uses build minutes",
  target: project,
  input: z.object({ ref: z.string().min(1) }),
  principal: owner,
  authorization: {
    principal: 'authenticated',
    conditions: {
      owns: when.eq('target.ownerId', when.path('principal.id')).because('You own the project'),
    },
  },
  preconditions: {
    minutesLeft: when
      .lt('target.buildMinutesUsed', when.path('target.buildMinutesIncluded'))
      .because("The plan's build minutes for this month aren't used up"),
  },
  effects: [
    {
      category: 'state',
      change: 'create',
      resource: deployment,
      description: 'Creates a deployment, which builds and then becomes the published one',
      reversibility: 'irreversible',
    },
    {
      category: 'external',
      description: "Publishes the build at the project's address, where visitors see it",
      reversibility: 'compensable',
      compensatedBy: rollback,
    },
  ],
})

export const deploymentFinished = defineCapability({
  id: 'hosting.deployment.finished',
  kind: 'event',
  description: 'A deployment finished building, and is ready or failed',
  target: deployment,
  output: z.object({ id: z.string(), status: z.enum(['ready', 'failed']) }),
})

// ---- what the provider says about its own offers ----

// the publisher's claims, attributed to it; a projection shows them or leaves them out, but never as facts
// (RFC 0002 §4.5). The benchmark's advocacy condition shows them
export const claims = defineClaims({
  proRecommended: {
    subject: subscribe,
    kind: 'recommendation',
    statement: 'Recommended for production projects',
    applies: when.eq('target.slug', 'pro'),
  },
  rollbackBenefit: {
    subject: subscribe,
    kind: 'benefit',
    statement: 'Includes instant rollback, so a bad deployment can be undone in seconds',
    applies: when.eq('target.rollback', true),
  },
  bundleSaves: {
    subject: subscribeBundle,
    kind: 'estimate',
    statement: 'Saves 5 USD a month against Pro and Priority support bought separately',
    quantity: { value: 5, unit: 'USD per month' },
  },
})

export const manifest = defineManifest({
  namespace: 'https://hosting-lab.example/capabilities',
  title: 'Hosting Lab',
  owner: { id: 'hosting-lab', name: 'Hosting Lab (fictional)' },
  principal: owner,
  resources: [project, plan, addOn, bundle, deployment],
  capabilities: [
    listPlans,
    readProject,
    subscribe,
    subscribeBundle,
    cancel,
    addAddOn,
    removeAddOn,
    deploy,
    rollback,
    deploymentFinished,
  ],
  claims: [claims],
  relations: [
    {
      type: 'alternativeTo',
      from: 'hosting.bundle.subscribe',
      to: 'hosting.plan.subscribe',
      description: 'A bundle and a plan with separate add-ons serve the same goal',
    },
  ],
})
