// the inspector shows a full projection: every offer a principal may see, including what a policy's view omits.
// RFC 0002 §11 keeps that off every agent-facing surface, and agents drive this app's pages (M7f's browser agent
// among them). So /inspect is off unless HOSTING_LAB_INSPECTOR=1, and nothing links to it
export const inspectorEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.HOSTING_LAB_INSPECTOR === '1'
