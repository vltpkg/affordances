import {
  base64url,
  canonicalJson,
  digestOf,
  getPointer,
  putPointer,
  evaluate,
  inputIssues,
  type CapabilityDefinition,
  type CapabilityManifest,
  type Condition,
  type Context,
  type Id,
  applyDefaults,
  renderConfirmation as render,
} from '@affordances/ir'
import { decideCondition, instancesOf } from './decide.ts'
import type { Facts } from './facts.ts'
import type { Loaded, Session } from './session.ts'
import { offerId, parseOfferId } from './offer-id.ts'
import type {
  ApprovalToken,
  CheckRequest,
  CheckResult,
  ExecutionRequest,
  ExecutionResult,
  Handler,
  ObservedChange,
  OfferChanges,
  Principal,
  Projection,
  ProjectionRequest,
  Refusal,
  RefusalCode,
  ResourceRef,
  ResourceResolver,
  TokenStore,
  View,
} from './types.ts'

type Obj = Record<string, unknown>

// what execution needs from the runtime: the definitions, the handlers, and a per-request session (project.ts)
export type ExecutionDeps = {
  manifest: CapabilityManifest
  facts: Facts
  resources: Record<Id, ResourceResolver>
  project: (request: ProjectionRequest, shared?: Session) => Promise<Projection>
  handlers: Record<Id, Handler>
  session: (principal: Principal) => Promise<Session>
  approval: {
    keys?: { current: CryptoKey; previous?: CryptoKey }
    store?: TokenStore
    ttlMs: number
    now: () => number
  }
}

/**
 * @experimental What a handler throws to refuse a call the application's own state no longer allows, though every
 * declared check passed: approving the bundle a project already has, say. It's the caller's to correct, so the result
 * is a `precondition` refusal with this message as its detail, never a failure. Thrown before the handler changes
 * anything: a refusal observes nothing (code review of M8, #2)
 */
export class HandlerRefusal extends Error {}

// §8.3: a detail is at most 280 characters, and says when it was cut
const DETAIL = 280
const withDetail = (detail: string | undefined) =>
  detail === undefined
    ? {}
    : detail.length > DETAIL
      ? { detail: detail.slice(0, DETAIL), detailTruncated: true as const }
      : { detail }

// an HMAC-SHA-256 over a call's canonical bytes
const sign = async (key: CryptoKey, call: Obj) =>
  new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalJson(call))),
  )

// §8.3: the offers whose existence or availability changed, in the caller's view: a result goes on the wire, so it
// carries only what that view shows, shaped as it shows it (review of M3e; §11)
const compare = (before: View, after: View): OfferChanges => {
  const was = new Map(before.offers.map((o) => [o.id, o]))
  const now = new Map(after.offers.map((o) => [o.id, o]))
  return {
    added: after.offers.filter((o) => !was.has(o.id)),
    removed: before.offers.filter((o) => !now.has(o.id)).map((o) => o.id),
    changed: after.offers.flatMap((o) => {
      const old = was.get(o.id)
      return old && canonicalJson(old.availability) !== canonicalJson(o.availability)
        ? [{ id: o.id, availability: o.availability }]
        : []
    }),
  }
}

export const executor = (deps: ExecutionDeps) => {
  const { manifest, handlers, approval } = deps
  const definitions = new Map(manifest.capabilities.map((c) => [c.id, c]))

  // §8.2: HMAC-SHA-256 over the canonical call. The token carries only its expiry, its nonce and the MAC, so it
  // echoes nothing about the caller; verifying recomputes the MAC from the call being made
  const issue = async (call: Obj) => {
    const keys = approval.keys!
    const expiresAt = new Date(approval.now() + approval.ttlMs).toISOString()
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)))
    const mac = await sign(keys.current, { ...call, expiresAt, nonce })
    // '~' separates: an ISO time has dots, and base64url has neither
    return { approval: `${expiresAt}~${nonce}~${base64url(mac)}`, expiresAt }
  }
  // true for a token issued for exactly this call, unexpired, under the current or the previous key
  const verify = async (token: ApprovalToken, call: Obj) => {
    const [expiresAt, nonce, mac] = token.split('~') as [string?, string?, string?]
    if (!expiresAt || !nonce || !mac || !(Date.parse(expiresAt) > approval.now())) return undefined
    let given: Uint8Array<ArrayBuffer>
    try {
      given = Uint8Array.from(atob(mac.replaceAll('-', '+').replaceAll('_', '/')), (ch) =>
        ch.charCodeAt(0),
      )
    } catch {
      return undefined
    }
    const bytes = new TextEncoder().encode(canonicalJson({ ...call, expiresAt, nonce }))
    // crypto.subtle.verify compares in constant time (review of M3d), so a MAC isn't guessed byte by byte
    for (const key of [approval.keys!.current, approval.keys!.previous])
      if (key && (await crypto.subtle.verify('HMAC', key, given, bytes)))
        return { nonce, expiresAt: new Date(expiresAt) }
    return undefined
  }

  // §8.1 steps 1-8 as one walk: check stops before tokens and running, execute goes on
  const walk = async (
    request: CheckRequest & { approval?: ApprovalToken },
    mode: 'check' | 'execute',
  ): Promise<
    | Refusal
    | {
        status: 'ready'
        c: CapabilityDefinition
        input: unknown
        target?: ResourceRef
        refs: Record<string, { key: string; attributes: Obj } | undefined>
        revision: string
        confirmed?: true
        // the walk's session, whose loads the before projection and snapshot reuse
        session: Session
      }
  > => {
    const s = await deps.session(request.principal)
    let c: CapabilityDefinition | undefined
    let target: ResourceRef | undefined
    // the references the offer id binds, and with them every one the input names (step 5)
    const named: Record<string, string> = {}
    const bound: Record<string, string> = {}
    // the offer revision the decision is made at: of the offer the caller named, as a projection computes it now
    const revision = async () =>
      (c && (await s.revisionOf(c, target, named))) ??
      (await digestOf({ ...s.base, resources: [], guards: [] }))
    const refuse = async (
      code: RefusalCode,
      extra: Omit<Refusal, 'status' | 'code' | 'revision'> = {},
    ): Promise<Refusal> => ({ status: 'refused', code, ...extra, revision: await revision() })

    // 1. resolve the offer id afresh: it grants nothing
    const parts = parseOfferId(request.offer)
    c = parts ? definitions.get(parts.capability) : undefined
    if (!parts || !c || c.kind === 'event')
      return refuse('not_found', withDetail(`No capability offer '${request.offer}'`))
    let input: unknown =
      request.input === undefined ? undefined : structuredClone(request.input as object)
    if (parts.target) {
      if (parts.target.type !== c.target)
        return refuse('not_found', withDetail(`${c.id} doesn't act on ${parts.target.type}`))
      target = parts.target
    } else if (c.target) {
      // a caller that skipped projection names the target in the input (§8.1, step 4)
      const key = c.targetAt ? getPointer(input, c.targetAt) : undefined
      if (typeof key !== 'string')
        return refuse('not_found', withDetail(`${c.id} needs a ${c.target} to act on`))
      target = { type: c.target, key }
    }
    for (const [name, key] of Object.entries(parts.with ?? {})) {
      if (!(c.references ?? []).some((r) => r.name === name))
        return refuse('not_found', withDetail(`${c.id} has no reference ${name}`))
      bound[name] = key
      named[name] = key
    }
    const context: Context = { principal: s.attributes, references: {} }
    let targetArg: { key: string; attributes: Obj } | undefined
    if (target) {
      const loaded = await s.load(target.type, target.key)
      if (loaded.state === 'none')
        return refuse('not_found', withDetail(`No ${target.type} '${target.key}'`))
      if (loaded.state === 'found') {
        context.target = loaded.attributes
        targetArg = { key: target.key, attributes: loaded.attributes }
      }
    }

    // a guard at execution: with the input, execution-only ones included
    const refs: Record<string, { key: string; attributes: Obj } | undefined> = {}
    // authorization never reads the input (RFC 0001 §3.2), so its guards get none, as at projection (code review 5)
    const decide = async (x: Condition, authorizing = false) => {
      const d = await decideCondition(
        x,
        context,
        handlers[c.id]?.guards?.[x.id],
        {
          input: authorizing ? undefined : (input as Obj | undefined),
          target: targetArg,
          refs,
          principal: request.principal,
        },
        { withInput: true },
      )
      // an unknown refuses (rule 5), saying it couldn't be checked when nothing says more
      return d.value === 'unknown' && d.detail === undefined
        ? { value: d.value, detail: `${x.description}: couldn't be checked` }
        : d
    }

    // 2. authorization, on the principal and the target only (RFC 0001 §3.2)
    if (!c.authorization)
      return refuse(
        'unauthorized',
        withDetail(`${c.id} declares no authorization, so it can't run`),
      )
    if (c.authorization.principal === 'authenticated' && !request.principal.authenticated)
      return refuse('unauthorized', withDetail(`${c.id} needs a signed-in caller`))
    for (const x of c.authorization.conditions ?? []) {
      const { value, detail } = await decide(x, true)
      if (value !== true)
        return refuse('unauthorized', {
          condition: { id: x.id, description: x.description },
          ...withDetail(detail),
        })
    }

    // 3. rate limits: the runtime has none to apply (§11 registers no limiter), so the binding's own apply

    // 4. the input: the target's key and each bound reference's key agree with the offer, then the schema
    const fill = (
      pointer: string,
      key: string,
      what: string,
    ): Refusal | undefined | Promise<Refusal> => {
      const given = getPointer(input, pointer)
      if (given === undefined) {
        if (input === undefined) input = {}
        if (input !== null && typeof input === 'object') putPointer(input as Obj, pointer, key)
        return
      }
      if (given !== key)
        return refuse(
          'invalid_input',
          withDetail(`The input names ${what} '${String(given)}', and the offer '${key}'`),
        )
    }
    if (target && c.targetAt) {
      const refused = await fill(c.targetAt, target.key, `the ${target.type}`)
      if (refused) return refused
    }
    for (const r of c.references ?? [])
      if (bound[r.name] !== undefined) {
        const refused = await fill(r.at, bound[r.name]!, `the ${r.resource}`)
        if (refused) return refused
      }
    if (c.input !== undefined) {
      const issues = inputIssues(c.input, input)
      if (issues.length) return refuse('invalid_input', { issues })
      // the effective input: the schema's declared defaults applied. It's the one value the summary renders, the
      // approval binds and the handler runs, so a handler never defaults on its own (intake, 2026-11-18; RFC 0002 §8.1)
      input = applyDefaults(c.input, input)
    }
    context.input = (input ?? {}) as Obj

    // 5. references: each key the input names is loaded, and one that resolves to nothing refuses
    for (const r of c.references ?? []) {
      const key = getPointer(input, r.at)
      if (typeof key !== 'string') continue
      const loaded = await s.load(r.resource, key)
      if (loaded.state === 'none')
        return refuse('not_found', withDetail(`No ${r.resource} '${key}'`))
      bound[r.name] = key
      if (loaded.state === 'found') {
        context.references![r.name] = loaded.attributes
        refs[r.name] = { key, attributes: loaded.attributes }
      }
    }

    // 6. every precondition: false and unknown both refuse (RFC 0001, rule 5)
    for (const x of c.preconditions ?? []) {
      const { value, detail } = await decide(x)
      if (value !== true)
        return refuse('precondition', {
          condition: { id: x.id, description: x.description },
          ...withDetail(detail),
        })
    }

    // 7. freshness, only when asked, and never instead of 2-6
    const now = await revision()
    if (request.ifRevision !== undefined && request.ifRevision !== now)
      return refuse('stale', withDetail("The offer's state has changed since that revision"))

    // 8. confirmation, from the definition: nothing annotated removes it (§9, R2)
    if (c.confirmation) {
      // with every charge it makes, each with its amount (RFC 0001 §3.2 and §4)
      const summary = render(c.confirmation.summary, c.effects, context)
      if (mode === 'check') {
        // v0's own confirm, recorded with its basis: never an approval (C3.1)
        if (!request.confirmed)
          return refuse('confirmation_required', { confirmation: { summary } })
        return {
          status: 'ready',
          c,
          input,
          target,
          refs,
          revision: now,
          confirmed: true,
          session: s,
        }
      }
      if (!request.principal.subject)
        return refuse('unauthorized', withDetail('Approval needs an identified caller'))
      const call = {
        offer: offerId({
          capability: c.id,
          target,
          with: Object.keys(bound).length ? bound : undefined,
        }),
        input: await digestOf(input ?? null),
        summary,
        subject: request.principal.subject,
        revision: now,
      }
      const verified = request.approval ? await verify(request.approval, call) : undefined
      // a token for another call, an expired one, or one already used: a fresh one, for this exact call
      if (!verified || !(await approval.store!.claim(verified.nonce, verified.expiresAt)))
        return refuse('confirmation_required', {
          confirmation: { summary, ...(await issue(call)) },
        })
    }
    return { status: 'ready', c, input, target, refs, revision: now, session: s }
  }

  const check = async (request: CheckRequest): Promise<CheckResult> => {
    // check never takes a token, whatever the caller sends
    const { approval: _ignored, ...rest } = request as CheckRequest & { approval?: unknown }
    const r = await walk(rest, 'check')
    if (r.status === 'refused') return r as CheckResult
    return r.confirmed
      ? { status: 'ok', revision: r.revision, confirmation: { basis: 'v0-client-flag' } }
      : { status: 'ok', revision: r.revision }
  }

  // §8.4: what the resolvers report for the target and every instance of a type a state effect names
  type Seen = Map<string, { type: Id; key: string; attributes: Obj }>
  // through a session's load, so what the checks just read isn't read again; after the run, a fresh session's
  const snapshot = async (
    load: (type: Id, key: string) => Promise<Loaded>,
    principal: Principal,
    c: CapabilityDefinition,
    target?: ResourceRef,
  ) => {
    const seen: Seen = new Map()
    // an instance whose load failed can't be compared: it's left out of both sides
    const unseen = new Set<string>()
    const types = new Set<Id>()
    if (c.target) types.add(c.target)
    for (const e of c.effects ?? []) if (e.category === 'state') types.add(e.resource)
    for (const type of [...types].toSorted()) {
      const keys = await instancesOf(
        deps.resources[type]!,
        principal,
        c.id,
        target?.type === type ? target.key : undefined,
      )
      for (const key of keys) {
        const where = canonicalJson([type, key])
        const loaded = await load(type, key)
        if (loaded.state === 'found') seen.set(where, { type, key, attributes: loaded.attributes })
        else if (loaded.state === 'failed') unseen.add(where)
      }
    }
    return { seen, unseen }
  }
  const observe = (
    c: CapabilityDefinition,
    before: Awaited<ReturnType<typeof snapshot>>,
    after: Awaited<ReturnType<typeof snapshot>>,
    target: ResourceRef | undefined,
  ) => {
    // the effects in canonical order (RFC 0001 §7.2), so matches means the same effect to every reader
    const effects = deps.facts.effects(c.id)
    const observed: ObservedChange[] = []
    const keys = new Set([...before.seen.keys(), ...after.seen.keys()])
    for (const where of [...keys].toSorted()) {
      if (before.unseen.has(where) || after.unseen.has(where)) continue
      const was = before.seen.get(where)
      const now = after.seen.get(where)
      const { type, key } = (now ?? was)!
      let change: ObservedChange['change']
      let attributes: string[] | undefined
      if (!was) change = 'create'
      else if (!now) change = 'delete'
      else {
        const declared = deps.facts.declared(type)
        attributes = [...new Set([...Object.keys(was.attributes), ...Object.keys(now.attributes)])]
          .filter(
            (k) =>
              (!declared || declared.has(k)) &&
              canonicalJson(was.attributes[k] ?? null) !== canonicalJson(now.attributes[k] ?? null),
          )
          .toSorted()
        if (!attributes.length) continue
        change = 'update'
      }
      const o: ObservedChange = { resource: { type, key }, change }
      if (attributes) o.attributes = attributes
      const matches = effects.findIndex(
        (e) => e.category === 'state' && e.resource === type && e.change === change,
      )
      if (matches >= 0) {
        o.matches = matches
        const effect = effects[matches]!
        // establishes reads target.*, so it's checked on the target after the run, and only there
        if (
          effect.category === 'state' &&
          effect.establishes &&
          now &&
          target?.type === type &&
          target.key === key &&
          evaluate(effect.establishes, { target: now.attributes }) === false
        )
          o.contradicts = true
      }
      observed.push(o)
    }
    return { observed, undeclared: observed.filter((o) => o.matches === undefined) }
  }

  const execute = async (request: ExecutionRequest): Promise<ExecutionResult> => {
    // confirmed is check's, for v0: execute takes only an approval
    const { confirmed: _ignored, ...rest } = request as ExecutionRequest & { confirmed?: unknown }
    const r = await walk(rest, 'execute')
    if (r.status === 'refused') return r
    // createRuntime refuses to start without a run for every query and action (§11)
    const handler = handlers[r.c.id]!
    // the caller's projection, before: what changes are measured against (§8.3)
    const view: ProjectionRequest = { ...request.view, principal: request.principal }
    const start = view.start ?? r.target
    if (start !== undefined) view.start = start
    // the before pair shares the walk's session, so nothing the checks read is read again, and runs at once
    const [projected, before] = await Promise.all([
      deps.project(view, r.session).then((p) => p.view()),
      snapshot(r.session.load, request.principal, r.c, r.target),
    ])
    // 9. run the application's handler
    let output: unknown
    let failure: string | undefined
    try {
      output = await handler.run!(r.input, {
        principal: request.principal,
        target: r.target,
        refs: r.refs,
      })
      if (r.c.output !== undefined && inputIssues(r.c.output, output).length)
        failure = "The action's result wasn't what it declares."
    } catch (error) {
      if (error instanceof HandlerRefusal)
        return {
          status: 'refused',
          code: 'precondition',
          ...withDetail(error.message),
          revision: r.revision,
        }
      failure = 'The action failed.'
    }
    // 10. observe: what changed, against what was declared, and the view after, a partial effect included
    // and the after pair a fresh session, so it sees what the run changed
    const fresh = await deps.session(request.principal)
    const [afterSnapshot, after] = await Promise.all([
      snapshot(fresh.load, request.principal, r.c, r.target),
      deps.project(view, fresh).then((p) => p.view()),
    ])
    const seen = observe(r.c, before, afterSnapshot, r.target)
    const observed = { ...seen, revision: after.revision, changes: compare(projected, after) }
    if (failure !== undefined) return { status: 'failed', message: failure, ...observed }
    const result: ExecutionResult = { status: 'succeeded', ...observed }
    if (output !== undefined) result.output = output
    const message = handler.message?.({ input: r.input, output })
    if (message !== undefined) result.message = message
    return result
  }

  return { check, execute }
}
