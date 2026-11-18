# hosting-lab's reference bindings, checked by hand

**SPIKE:** measurement input for assumption 8.

**Why:** `reference.ts` took each capability's binding, its (route, action), from the extractor's view of the real, bound hosting-lab. Matching is by binding (SCORING.md §4), so an extractor binding error would be baked into the reference, and that part of the scoring would be circular (the planner, 2026-11-18 11:50Z).

**The check,** done independently of the extractor, before the measurement runs, from hosting-lab's source at ac15d7a9:

- **the route:** the folder of the `actions.ts` that holds the `defineAction`, under `src/app`, with no route groups or parallel slots on any of these paths;
- **the action:** that `defineAction`'s `name:` literal;
- **the capability:** the import its `capability:` names, traced to that export's `id:` in `src/app/capabilities.ts`.

| capability                  | route          | action            | defineAction (file:line)             | capability import, and id (file:line)                                            |
| --------------------------- | -------------- | ----------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| hosting.subscription.cancel | `/`            | `cancel`          | src/app/actions.ts:12-14             | `cancel as cancelCapability`, actions.ts:9; capabilities.ts:135                  |
| hosting.plan.list           | `/plans`       | `listPlans`       | src/app/plans/actions.ts:15-17       | `listPlans as listCapability`, plans/actions.ts:9; capabilities.ts:94            |
| hosting.plan.subscribe      | `/plans`       | `subscribe`       | src/app/plans/actions.ts:22-24       | `subscribe as subscribeCapability`, plans/actions.ts:10; capabilities.ts:168     |
| hosting.bundle.subscribe    | `/plans`       | `subscribeBundle` | src/app/plans/actions.ts:36-38       | `subscribeBundle as bundleCapability`, plans/actions.ts:11; capabilities.ts:212  |
| hosting.addOn.add           | `/add-ons`     | `addAddOn`        | src/app/add-ons/actions.ts:11-13     | `addAddOn as addCapability`, add-ons/actions.ts:8; capabilities.ts:285           |
| hosting.addOn.remove        | `/add-ons`     | `removeAddOn`     | src/app/add-ons/actions.ts:25-27     | `removeAddOn as removeCapability`, add-ons/actions.ts:8; capabilities.ts:259     |
| hosting.deployment.create   | `/deployments` | `deploy`          | src/app/deployments/actions.ts:13-15 | `deploy as deployCapability`, deployments/actions.ts:10; capabilities.ts:367     |
| hosting.deployment.rollback | `/deployments` | `rollback`        | src/app/deployments/actions.ts:28-30 | `rollback as rollbackCapability`, deployments/actions.ts:10; capabilities.ts:330 |

**The result:** all 8 equal `hosting-lab-reference.json`'s bindings, so the reference is unchanged.
