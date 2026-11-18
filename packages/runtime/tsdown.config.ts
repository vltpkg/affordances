import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

// the runtime; /agent, its transport-free, browser-safe agent tools (RFC 0004 §3 and §4), which MCP and WebMCP both
// use; and /agent-runtime, their in-process adapter, server-side only
export default defineConfig({
  ...base,
  entry: ['src/index.ts', 'src/agent.ts', 'src/agent-runtime.ts'],
})
