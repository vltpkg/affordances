// the slice of WebMCP (https://developer.chrome.com/docs/ai/webmcp/imperative-api) afford uses
export type ModelContextTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean }
  execute: (input: unknown, options: { signal?: AbortSignal }) => Promise<unknown>
}

export type ModelContext = {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => unknown
}

// document.modelContext is current; navigator.modelContext is the earlier spelling
export const getModelContext = (): ModelContext | undefined => {
  if (typeof document === 'undefined') return
  return (
    (document as { modelContext?: ModelContext }).modelContext ??
    (navigator as { modelContext?: ModelContext }).modelContext
  )
}
