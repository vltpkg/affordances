import os from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import { busy, clockCheck, leastRatio } from './support/timing.ts'

// intake's rule for clock-only checks (support/timing.ts): skipped, visibly, above one runnable task per core, and
// never under CI. Everything a test checks besides the clock runs whatever the load
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const load = (perCore: number) => {
  vi.spyOn(os, 'availableParallelism').mockReturnValue(16)
  vi.spyOn(os, 'loadavg').mockReturnValue([16 * perCore, 0, 0])
}

test('on a busy machine a clock-only check is skipped, saying so with the load', () => {
  load(2)
  vi.stubEnv('CI', '')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  let ran = false
  clockCheck('under 2s', () => (ran = true))
  expect([busy(), ran]).toEqual([true, false])
  expect(warn).toHaveBeenCalledWith(
    '[md] skipped the timing check "under 2s": load 32.0 on 16 cores (CI never skips)',
  )
})

test('under CI it always runs, however busy', () => {
  load(4)
  vi.stubEnv('CI', 'true')
  let ran = false
  clockCheck('under 2s', () => (ran = true))
  expect([busy(), ran]).toEqual([false, true])
})

test('on a busy machine a ratio still runs its large case once, for the output the test checks', () => {
  load(2)
  vi.stubEnv('CI', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const calls = { small: 0, large: 0 }
  const ratio = leastRatio(
    () => (calls.small++, 1),
    () => (calls.large++, 100),
    24,
  )
  expect([ratio, calls]).toEqual([0, { small: 0, large: 1 }])
})

test('on a quiet machine a planted quadratic still fails its ratio, every time it’s measured again', () => {
  load(0.5)
  vi.stubEnv('CI', '')
  // small costs 1, large 64: a quadratic, at 8x the size
  expect(
    leastRatio(
      () => 1,
      () => 64,
      24,
    ),
  ).toBe(64)
  // and a linear one passes
  expect(
    leastRatio(
      () => 1,
      () => 8,
      24,
    ),
  ).toBe(8)
})
