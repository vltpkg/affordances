// each v0 action the app serves, by its route pattern and name, and the capability it's bound to (RFC 0001 §12.1). The
// compiler derives the same from the app's source (test/v0-bindings.test.ts holds them equal), so a v0 trial's calls
// replay through the runtime as the capability they are (M7f's v0 cell, surfaces/PLAN.md §5)
export const v0Bindings: readonly { route: string; action: string; capability: string }[] = [
  { route: '/', action: 'cancel', capability: 'hosting.subscription.cancel' },
  { route: '/add-ons', action: 'addAddOn', capability: 'hosting.addOn.add' },
  { route: '/add-ons', action: 'removeAddOn', capability: 'hosting.addOn.remove' },
  { route: '/deployments', action: 'deploy', capability: 'hosting.deployment.create' },
  { route: '/deployments', action: 'rollback', capability: 'hosting.deployment.rollback' },
  { route: '/plans', action: 'listPlans', capability: 'hosting.plan.list' },
  { route: '/plans', action: 'subscribe', capability: 'hosting.plan.subscribe' },
  { route: '/plans', action: 'subscribeBundle', capability: 'hosting.bundle.subscribe' },
]
