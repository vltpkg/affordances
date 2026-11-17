import { beforeEach, expect, test } from 'vitest'
import * as store from '../src/lib/store.ts'

// the application's logic: every consequence the manifest declares is observable in the store, and the store
// enforces the domain's rules itself, since v0's UI path doesn't evaluate declared conditions (RFC 0001 §8.3)

beforeEach(() => store.reset())

const sid = 's_1'
const project = () => store.account(sid).project
const ledger = () => store.account(sid).ledger

test('a new account has one project, on Hobby, with no charges', () => {
  expect(project()).toMatchObject({ plan: 'hobby', renewsAs: 'hobby', addOns: [], bundle: null })
  expect(ledger()).toEqual([])
  expect(store.monthlyUsd(project())).toBe(0)
})

test('subscribing moves the plan, and charges the first month at once, as declared', () => {
  store.subscribePlan(store.account(sid).id, project().id, 'p2')
  expect(project()).toMatchObject({ plan: 'pro', renewsAs: 'pro' })
  expect(ledger().map((c) => [c.description, c.usd])).toEqual([['Pro, first month', 20]])
  expect(store.monthlyUsd(project())).toBe(20)
  expect(() => store.subscribePlan(store.account(sid).id, project().id, 'p2')).toThrow(
    /Pro is already the plan/,
  )
})

test('cancelling keeps the plan to the end of the month, and renews as Hobby', () => {
  store.subscribePlan(store.account(sid).id, project().id, 'p3')
  store.cancel(store.account(sid).id, project().id)
  expect(project()).toMatchObject({ plan: 'business', renewsAs: 'hobby' })
  // nothing already charged is refunded
  expect(ledger().map((c) => c.usd)).toEqual([80])
  expect(() => store.cancel(store.account(sid).id, project().id)).toThrow(/already renews as Hobby/)
})

test('the bundle sets the plan and its add-on for one price, less than its parts', () => {
  store.subscribeBundle(store.account(sid).id, project().id, 'pro-plus')
  // the included add-on comes with the bundle, and isn't bought on its own
  expect(project()).toMatchObject({ plan: 'pro', bundle: 'pro-plus', addOns: [] })
  expect(store.effectiveAddOns(project())).toEqual(['priority-support'])
  expect(store.monthlyUsd(project())).toBe(35)
  expect(ledger().map((c) => [c.description, c.usd])).toEqual([['Pro Plus, first month', 35]])
})

test('add-ons charge their first month, and stop at the end of the month when removed', () => {
  store.addAddOn(store.account(sid).id, project().id, 'daily-backups')
  expect(project().addOns).toEqual(['daily-backups'])
  expect(store.monthlyUsd(project())).toBe(5)
  expect(() => store.addAddOn(store.account(sid).id, project().id, 'daily-backups')).toThrow(
    /already has Daily backups/,
  )
  store.removeAddOn(store.account(sid).id, project().id, 'daily-backups')
  expect(project().removing).toEqual(['daily-backups'])
  expect(() => store.removeAddOn(store.account(sid).id, project().id, 'extra-bandwidth')).toThrow(
    /doesn't have/,
  )
})

test('deploying uses build minutes and publishes; a broken build fails; minutes run out', () => {
  const id = project().id
  expect(store.deploy(store.account(sid).id, id, 'main')).toEqual({ id: 'dep_1', status: 'ready' })
  expect(store.deploy(store.account(sid).id, id, 'broken-branch')).toEqual({
    id: 'dep_2',
    status: 'failed',
  })
  expect(store.deploymentList(project()).map((d) => [d.id, d.status, d.current])).toEqual([
    ['dep_2', 'failed', false],
    ['dep_1', 'ready', true],
  ])
  expect(project().buildMinutesUsed).toBe(2 * store.MINUTES_PER_DEPLOY)
  // Hobby includes 100 minutes, so the fourth deploy is the last
  store.deploy(store.account(sid).id, id, 'a')
  store.deploy(store.account(sid).id, id, 'b')
  expect(() => store.deploy(store.account(sid).id, id, 'c')).toThrow(
    /build minutes for this month are used up/,
  )
})

test('rollback needs a plan with rollback, a ready deployment, and one that is not already published', () => {
  const id = project().id
  store.deploy(store.account(sid).id, id, 'v1')
  store.deploy(store.account(sid).id, id, 'v2')
  expect(store.rollbackRefusal(store.account(sid).id, 'dep_1')).toBe(
    "Hobby doesn't include rollback",
  )
  store.subscribePlan(store.account(sid).id, id, 'p2')
  expect(store.rollbackRefusal(store.account(sid).id, 'dep_2')).toBe('dep_2 is already published')
  store.rollback(store.account(sid).id, 'dep_1')
  expect(store.deploymentList(project()).find((d) => d.current)?.id).toBe('dep_1')
})

test("a project the caller doesn't own is refused like one that doesn't exist", () => {
  const other = store.account('s_2').project.id
  expect(() => store.subscribePlan(store.account(sid).id, other, 'p2')).toThrow(
    `No project ${other}`,
  )
  expect(() => store.deploy(store.account(sid).id, other, 'main')).toThrow(`No project ${other}`)
  expect(store.account('s_2').ledger).toEqual([])
})

test("the project's attributes are the ones the manifest declares", () => {
  expect(Object.keys(store.projectAttributes(project())).toSorted()).toEqual(
    [
      'addOns',
      'buildMinutesIncluded',
      'buildMinutesUsed',
      'id',
      'ownerId',
      'plan',
      'renewsAs',
    ].toSorted(),
  )
})

test('leaving the bundle takes its included add-on with it, and never bills it', () => {
  const id = project().id
  store.subscribeBundle(store.account(sid).id, id, 'pro-plus')
  store.subscribePlan(store.account(sid).id, id, 'p3')
  expect(store.effectiveAddOns(project())).toEqual([])
  expect(store.monthlyUsd(project())).toBe(80)
  store.subscribeBundle(store.account(sid).id, id, 'pro-plus')
  store.subscribePlan(store.account(sid).id, id, 'p2')
  expect(store.effectiveAddOns(project())).toEqual([])
  expect(store.monthlyUsd(project())).toBe(20)
})

test('an add-on bought on its own stays when the bundle goes, and the bundle never double-bills it', () => {
  const id = project().id
  store.addAddOn(store.account(sid).id, id, 'priority-support')
  store.subscribeBundle(store.account(sid).id, id, 'pro-plus')
  // bought and included: billed once, inside the bundle
  expect(store.monthlyUsd(project())).toBe(35)
  expect(() => store.addAddOn(store.account(sid).id, id, 'priority-support')).toThrow(
    /included in the project's bundle/,
  )
  store.subscribePlan(store.account(sid).id, id, 'p2')
  expect(store.effectiveAddOns(project())).toEqual(['priority-support'])
  expect(store.monthlyUsd(project())).toBe(40)
})

test("an add-on that only comes with the bundle can't be removed on its own", () => {
  store.subscribeBundle(store.account(sid).id, project().id, 'pro-plus')
  expect(() => store.removeAddOn(store.account(sid).id, project().id, 'priority-support')).toThrow(
    /comes with the bundle/,
  )
})
