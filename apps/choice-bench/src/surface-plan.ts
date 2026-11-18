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
// the PLAN's budget: one retry per trial, whether the first attempt was a harness fault or a CLI crash
export const PILOT_MAX_ATTEMPTS = 2

const specOf = (surface: SurfaceId, model: string, index: number, driver: string): TrialSpec => ({
  id: `pilot-${surface}-${PILOT_TASK}-${model}-${index}`.replace(/[^\w.-]/g, '_'),
  condition: 'A',
  surface,
  task: PILOT_TASK,
  model,
  driver,
  index,
})

/** The surfaces in index i's rotation: the list turned i places. */
export const rotation = (i: number) =>
  PILOT_SURFACES.map((_, k) => PILOT_SURFACES[(k + i) % PILOT_SURFACES.length]!)

/** The 60, in the order they run. driver 'fake' is the dry run's, with no model. */
export const surfacePilotPlan = (driver = 'claude-cli'): TrialSpec[] =>
  Array.from({ length: PILOT_PER_CELL }, (_, index) =>
    (index % 2 === 0 ? PILOT_MODELS : [...PILOT_MODELS].toReversed()).flatMap((model) =>
      rotation(index).map((surface) => specOf(surface, model, index, driver)),
    ),
  ).flat()
