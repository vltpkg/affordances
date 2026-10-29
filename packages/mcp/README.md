# @afford/mcp

Any Afford site as an MCP server, for Claude, Cursor, and other MCP clients. It gives the model two tools: `afford_open` reads a page's graph, and `afford_call` calls one of its actions and returns the delta. Actions that need confirmation answer with a summary first, to show the user before resending.

```bash
npx @afford/mcp https://store.example.com --token "$STORE_TOKEN"
```

```json
{
  "mcpServers": {
    "store": { "command": "npx", "args": ["@afford/mcp", "https://store.example.com"] }
  }
}
```

Without a token it keeps the site's cookies like a browser would. As a library, `createClient(site, { token })` returns `index()`, `open(path)`, and `call(path, action, input, confirm)`, and `createServer(site, options)` returns the `McpServer`.

Docs: [https://github.com/afford/afford/blob/main/apps/docs/content/mcp.mdx](https://github.com/afford/afford/blob/main/apps/docs/content/mcp.mdx)
