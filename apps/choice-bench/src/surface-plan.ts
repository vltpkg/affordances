import type { TrialSpec } from './harness.ts'
import type { SurfaceId } from './surfaces.ts'

// M7f's pilot (surfaces/PLAN.md §4): 6 surfaces × 2 models × 5 trials = 60, on T6, fixed at launch. Run interleaved
// and rotated as in M5 (its confirmatory amendment, intake 04:28Z): by index i = 0..4, each index's twelve specs side by
// side, Sonnet first when i is even and Haiku first when it's odd, and the surfaces rotated one place per index within
// each model, so no surface always runs first. The two workers take the next spec from this one ordered queue, so a
// drift in load, latency or the model over the run's hours falls on every arm alike. A spec's index fixes its plan-id
// order (permutationFor), as in M5

const PILOT_SURFACES: SurfaceId[] = ['full', 'progressive', 'v0', 'browser', 'mcp', 'webmcp']
// the 4 confirmatory surfaces: the re-pilot's (intake, 2026-11-18 18:37Z, after the pilot) and the confirmatory run's
const CONFIRMATORY_SURFACES: SurfaceId[] = ['full', 'progressive', 'v0', 'browser']
/** Every surface plan's models, Sonnet first on an even index and Haiku first on an odd one. */
export const SURFACE_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']

type PlanShape = {
  prefix: string
  surfaces: SurfaceId[]
  perCell: number
  task: string
  // the pause rule: the pilots' 'more than 2 faults' (true) or the confirmatory run's 'more than 2% of the trials run'
  pilot: boolean
}

/**
 * The plans the entry runs, by mode, each described once: its specs' prefix, surfaces, trials per cell and task, and
 * its pause rule. The pilot is 6 surfaces x 2 models x 5 on T6; the re-pilot the 4 confirmatory surfaces x 2 models x 2,
 * on the new pin with the approval sentence; the confirmatory run the same 4 x 2 x 50 = 400, on the re-pilot's pin
 */
export const RUN_PLANS = {
  pilot: { prefix: 'pilot', surfaces: PILOT_SURFACES, perCell: 5, task: 'T6', pilot: true },
  repilot: {
    prefix: 'repilot',
    surfaces: CONFIRMATORY_SURFACES,
    perCell: 2,
    task: 'T6',
    pilot: true,
  },
  confirmatory: {
    prefix: 'confirmatory',
    surfaces: CONFIRMATORY_SURFACES,
    perCell: 50,
    task: 'T6',
    pilot: false,
  },
} as const satisfies Record<string, PlanShape>
export type PlanName = keyof typeof RUN_PLANS

const specOf = (
  shape: PlanShape,
  surface: SurfaceId,
  model: string,
  index: number,
  driver: string,
): TrialSpec => ({
  id: `${shape.prefix}-${surface}-${shape.task}-${model}-${index}`.replace(/[^\w.-]/g, '_'),
  condition: 'A',
  surface,
  task: shape.task,
  model,
  driver,
  index,
})

/** A plan's surfaces in index i's rotation: the list turned i places. */
export const rotation = (i: number, surfaces: SurfaceId[]) =>
  surfaces.map((_, k) => surfaces[(k + i) % surfaces.length]!)

/**
 * A plan's specs, in the order they run: by index, each index's specs side by side, the model order alternating and
 * the surfaces rotated per index. Each index fixes its plan-id order, as in M5 (RFC 0003 §4). driver 'fake' is the dry
 * run's, with no model
 */
export const specsOf = (plan: PlanName, driver = 'claude-cli'): TrialSpec[] => {
  const shape: PlanShape = RUN_PLANS[plan]
  return Array.from({ length: shape.perCell }, (_, index) =>
    (index % 2 === 0 ? SURFACE_MODELS : [...SURFACE_MODELS].toReversed()).flatMap((model) =>
      rotation(index, shape.surfaces).map((surface) =>
        specOf(shape, surface, model, index, driver),
      ),
    ),
  ).flat()
}
