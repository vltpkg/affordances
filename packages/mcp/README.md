# @affordances/mcp

Any Affordances site as an MCP server, for Claude, Cursor, and other MCP clients. It gives the model two tools: `affordances_open` reads a page's graph, and `affordances_call` calls one of its actions and returns the delta. Actions that need confirmation answer with a summary first, to show the user before resending.

```bash
vlx @affordances/mcp https://store.example.com --token "$STORE_TOKEN"
```

```json
{
  "mcpServers": {
    "store": { "command": "vlx", "args": ["@affordances/mcp", "https://store.example.com"] }
  }
}
```

Without a token it keeps the site's cookies like a browser would. As a library, `createClient(site, { token })` returns `index()`, `open(path)`, and `call(path, action, input, confirm)`, and `createServer(site, options)` returns the `McpServer`.

Docs: [https://github.com/vltpkg/affordances/blob/main/apps/docs/content/guides/mcp.mdx](https://github.com/vltpkg/affordances/blob/main/apps/docs/content/guides/mcp.mdx)
