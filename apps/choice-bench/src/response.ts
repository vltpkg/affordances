// a tool call's response as the agent got it, parsed: every response is a JSON value (tools.ts's render), so the
// harness reads its fields, never its rendering's whitespace (boundary review #15). Undefined when it isn't JSON, as an
// error's text isn't
export const responseOf = (call: { response: string }): Record<string, any> | undefined => {
  try {
    const value = JSON.parse(call.response) as unknown
    return value !== null && typeof value === 'object' ? (value as Record<string, any>) : undefined
  } catch {
    return undefined
  }
}

// whether an execute call was refused for its confirmation: the runtime's own code, read from the parsed response
export const askedToConfirm = (call: { response: string }) =>
  responseOf(call)?.code === 'confirmation_required'
