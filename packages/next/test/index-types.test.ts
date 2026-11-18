import { createAffordances as createCore } from '@affordances/core'
import { expectTypeOf, test } from 'vitest'
import { createAffordances, defineAction, defineState } from '../src/index.ts'

// next's API types are core's own, named so the .d.ts refers to @affordances/core instead of inlining core's structure:
// for users, the same types as the inferred ones they replace (intake, 2026-11-18)
type Session = { user: string }

test('next’s createAffordances has core’s return type, for any session', () => {
  expectTypeOf(createAffordances<Session>).returns.toEqualTypeOf<
    ReturnType<typeof createCore<Session>>
  >()
  expectTypeOf(createAffordances<never>).returns.toEqualTypeOf<
    ReturnType<typeof createCore<never>>
  >()
})

test('defineAction and defineState are core’s, for the default session', () => {
  expectTypeOf(defineAction).toEqualTypeOf<ReturnType<typeof createCore<never>>['defineAction']>()
  expectTypeOf(defineState).toEqualTypeOf<ReturnType<typeof createCore<never>>['defineState']>()
})
