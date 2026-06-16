export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export function errorResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details, isError: true };
}
