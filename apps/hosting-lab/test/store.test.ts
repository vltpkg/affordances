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
  store.subscribePlan(sid, project().id, 'p2')
  expect(project()).toMatchObject({ plan: 'pro', renewsAs: 'pro' })
  expect(ledger().map((c) => [c.description, c.usd])).toEqual([['Pro, first month', 20]])
  expect(store.monthlyUsd(project())).toBe(20)
  expect(() => store.subscribePlan(sid, project().id, 'p2')).toThrow(/Pro is already the plan/)
})

test('cancelling keeps the plan to the end of the month, and renews as Hobby', () => {
  store.subscribePlan(sid, project().id, 'p3')
  store.cancel(sid, project().id)
  expect(project()).toMatchObject({ plan: 'business', renewsAs: 'hobby' })
  // nothing already charged is refunded
  expect(ledger().map((c) => c.usd)).toEqual([80])
  expect(() => store.cancel(sid, project().id)).toThrow(/already renews as Hobby/)
})

test('the bundle sets the plan and its add-on for one price, less than its parts', () => {
  store.subscribeBundle(sid, project().id, 'pro-plus')
  expect(project()).toMatchObject({ plan: 'pro', bundle: 'pro-plus', addOns: ['priority-support'] })
  expect(store.monthlyUsd(project())).toBe(35)
  expect(ledger().map((c) => [c.description, c.usd])).toEqual([['Pro Plus, first month', 35]])
})

test('add-ons charge their first month, and stop at the end of the month when removed', () => {
  store.addAddOn(sid, project().id, 'daily-backups')
  expect(project().addOns).toEqual(['daily-backups'])
  expect(store.monthlyUsd(project())).toBe(5)
  expect(() => store.addAddOn(sid, project().id, 'daily-backups')).toThrow(
    /already has Daily backups/,
  )
  store.removeAddOn(sid, project().id, 'daily-backups')
  expect(project().removing).toEqual(['daily-backups'])
  expect(() => store.removeAddOn(sid, project().id, 'extra-bandwidth')).toThrow(/doesn't have/)
})

test('deploying uses build minutes and publishes; a broken build fails; minutes run out', () => {
  const id = project().id
  expect(store.deploy(sid, id, 'main')).toEqual({ id: 'dep_1', status: 'ready' })
  expect(store.deploy(sid, id, 'broken-branch')).toEqual({ id: 'dep_2', status: 'failed' })
  expect(project().deployments.map((d) => [d.id, d.status, d.current])).toEqual([
    ['dep_2', 'failed', false],
    ['dep_1', 'ready', true],
  ])
  expect(project().buildMinutesUsed).toBe(2 * store.MINUTES_PER_DEPLOY)
  // Hobby includes 100 minutes, so the fourth deploy is the last
  store.deploy(sid, id, 'a')
  store.deploy(sid, id, 'b')
  expect(() => store.deploy(sid, id, 'c')).toThrow(/build minutes for this month are used up/)
})

test('rollback needs a plan with rollback, a ready deployment, and one that is not already published', () => {
  const id = project().id
  store.deploy(sid, id, 'v1')
  store.deploy(sid, id, 'v2')
  expect(store.rollbackRefusal(sid, 'dep_1')).toBe("Hobby doesn't include rollback")
  store.subscribePlan(sid, id, 'p2')
  expect(store.rollbackRefusal(sid, 'dep_2')).toBe('dep_2 is already published')
  store.rollback(sid, 'dep_1')
  expect(project().deployments.find((d) => d.current)?.id).toBe('dep_1')
})

test("a project the caller doesn't own is refused like one that doesn't exist", () => {
  const other = store.account('s_2').project.id
  expect(() => store.subscribePlan(sid, other, 'p2')).toThrow(`No project ${other}`)
  expect(() => store.deploy(sid, other, 'main')).toThrow(`No project ${other}`)
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
