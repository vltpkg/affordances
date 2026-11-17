import type { CapabilityDefinition, Id } from '@affordances/ir'
import type { CapabilityOffer, ResourceRef } from './types.ts'

type Obj = Record<string, unknown>

// what a request read of one instance: its attributes, none (it doesn't exist, or the principal may not see it), or
// a load that failed (it threw, or its attributes weren't plain data fitting the schema), whose attributes are then
// unknown (§2.1)
export type Loaded =
  | { state: 'found'; attributes: Obj; version?: string }
  | { state: 'none' }
  | { state: 'failed' }

// one instance as a revision reads it (§7): a load that failed has no version, which no version string equals
export type Read = { type: Id; key: string; version?: string }

// what one request reads, shared by projection and execution (project.ts's session)
export type Session = {
  attributes: Obj // the principal's declared attributes
  base: { manifest: string; principal: string } // what every revision of this request starts from (§7)
  loads: Map<string, Promise<Loaded>>
  load: (type: Id, key: string) => Promise<Loaded>
  // an instance as a revision reads it (§7), or undefined for one that isn't there
  read: (type: Id, key: string, loaded: Loaded) => Promise<Read | undefined>
  guardLog: { capability: Id; condition: string; value: boolean | string | null }[]
  offerOn: (
    c: CapabilityDefinition,
    target: ResourceRef | undefined,
    bind?: Record<string, string>,
  ) => Promise<CapabilityOffer | undefined>
}
