// the deployment's own origin, mirroring next's social-image fallback: dev → localhost, preview deploys → the
// preview url, production → the project's primary domain. SITE_URL overrides it for any other host.
const https = (host?: string) => (host ? `https://${host}` : undefined)

export const siteUrl = new URL(
  process.env.SITE_URL ??
    (process.env.NODE_ENV === 'development'
      ? `http://localhost:${process.env.PORT ?? 3000}`
      : process.env.VERCEL_ENV === 'preview'
        ? https(process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL)
        : https(process.env.VERCEL_PROJECT_PRODUCTION_URL)) ??
    `http://localhost:${process.env.PORT ?? 3000}`,
)

export const description =
  'Afford gives every page of a Next.js app a JSON view for agents, and turns one action definition into a server action, an HTTP endpoint, a WebMCP tool, and an MCP tool.'
