import type { TrialSpec } from './harness.ts'
import type { SurfaceId } from './surfaces.ts'

// M7f's pilot (surfaces/PLAN.md §4): 6 surfaces × 2 models × 5 trials = 60, on T6, fixed at launch. Run interleaved
// and rotated as in M5 (its confirmatory amendment, intake 04:28Z): by index i = 0..4, each index's twelve specs side by
// side, Sonnet first when i is even and Haiku first when it's odd, and the surfaces rotated one place per index within
// each model, so no surface always runs first. The two workers take the next spec from this one ordered queue, so a
// drift in load, latency or the model over the run's hours falls on every arm alike. A spec's index fixes its plan-id
// order (permutationFor), as in M5

export const PILOT_SURFACES: SurfaceId[] = ['full', 'progressive', 'v0', 'browser', 'mcp', 'webmcp']
export const PILOT_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5']
export const PILOT_PER_CELL = 5
export const PILOT_TASK = 'T6'

// the re-pilot (intake, 2026-11-18 18:37Z, after the pilot): the 4 confirmatory surfaces x 2 models x 2 = 16, in the
// same interleaved and rotated order, on the new pin with the approval sentence
export const REPILOT_SURFACES: SurfaceId[] = ['full', 'progressive', 'v0', 'browser']
export const REPILOT_PER_CELL = 2
// the confirmatory run (PLAN §4): the same 4 surfaces x 2 models x 50 = 400, on the re-pilot's pin
export const CONFIRMATORY_SURFACES: SurfaceId[] = REPILOT_SURFACES
export const CONFIRMATORY_PER_CELL = 50

type PlanShape = { prefix: string; surfaces: SurfaceId[]; perCell: number }

const specOf = (
  prefix: string,
  surface: SurfaceId,
  model: string,
  index: number,
  driver: string,
): TrialSpec => ({
  id: `${prefix}-${surface}-${PILOT_TASK}-${model}-${index}`.replace(/[^\w.-]/g, '_'),
  condition: 'A',
  surface,
  task: PILOT_TASK,
  model,
  driver,
  index,
})

/** A plan's surfaces in index i's rotation: the list turned i places. */
export const rotation = (i: number, surfaces: SurfaceId[] = PILOT_SURFACES) =>
  surfaces.map((_, k) => surfaces[(k + i) % surfaces.length]!)

// by index, each index's specs side by side, the model order alternating, the surfaces rotated per index
const planOf = (shape: PlanShape, driver: string): TrialSpec[] =>
  Array.from({ length: shape.perCell }, (_, index) =>
    (index % 2 === 0 ? PILOT_MODELS : [...PILOT_MODELS].toReversed()).flatMap((model) =>
      rotation(index, shape.surfaces).map((surface) =>
        specOf(shape.prefix, surface, model, index, driver),
      ),
    ),
  ).flat()

/** The pilot's 60, in the order they run. driver 'fake' is the dry run's, with no model. */
export const surfacePilotPlan = (driver = 'claude-cli') =>
  planOf({ prefix: 'pilot', surfaces: PILOT_SURFACES, perCell: PILOT_PER_CELL }, driver)

/** The re-pilot's 16, in the order they run. */
export const surfaceRepilotPlan = (driver = 'claude-cli') =>
  planOf({ prefix: 'repilot', surfaces: REPILOT_SURFACES, perCell: REPILOT_PER_CELL }, driver)

/** The confirmatory run's 400, in the order they run: each index fixes its plan-id order, as in M5 (RFC 0003 §4). */
export const surfaceConfirmatoryPlan = (driver = 'claude-cli') =>
  planOf(
    { prefix: 'confirmatory', surfaces: CONFIRMATORY_SURFACES, perCell: CONFIRMATORY_PER_CELL },
    driver,
  )

/**
 * The plans the entry runs, by mode: their specs, the surfaces their pinned preflight checks, and their pause rule,
 * the pilots' 'more than 2 faults' (pilot: true) or the confirmatory run's 'more than 2% of the trials run'
 */
export const RUN_PLANS = {
  pilot: { specs: surfacePilotPlan, surfaces: PILOT_SURFACES, pilot: true },
  repilot: { specs: surfaceRepilotPlan, surfaces: REPILOT_SURFACES, pilot: true },
  confirmatory: { specs: surfaceConfirmatoryPlan, surfaces: CONFIRMATORY_SURFACES, pilot: false },
} as const
