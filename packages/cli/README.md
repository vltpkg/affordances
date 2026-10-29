# @affordances/cli

The `affordances` command: set up a Next.js app, and see and call any page the way an agent does.

```bash
vlx @affordances/cli init                       # route handler, withAffordances, .gitignore, manifest
vlx @affordances/cli build                      # regenerate .affordances/manifest.ts
vlx @affordances/cli open localhost:3000/cart   # the page's graph, as an agent gets it
vlx @affordances/cli call localhost:3000/products/tee addToCart --input '{"sku":"TEE-BLK-M"}'
```

Every command takes `--json` and exits 1 on failure, so scripts and coding agents can drive it. Built on [Effect](https://effect.website), which is bundled into the one file that ships.

Docs: [https://github.com/affordances/affordances/blob/main/apps/docs/content/reference/cli.mdx](https://github.com/affordances/affordances/blob/main/apps/docs/content/reference/cli.mdx)
