const MAX_MCP_POST_BYTES = 1_048_576;

/** Validate the actual streamed payload, not a client-supplied Content-Length alone. */
export async function mcpPostBodyTooLarge(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  const reported = request.headers.get("content-length");
  if (reported !== null) {
    const length = Number(reported);
    if (!Number.isFinite(length) || length < 0 || length > MAX_MCP_POST_BYTES) return true;
  }
  if (!request.body) return false;
  const reader = request.clone().body?.getReader();
  if (!reader) return false;
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_MCP_POST_BYTES) {
        // A tee branch cancellation can wait indefinitely for the untouched transport branch.
        void reader.cancel().catch(() => undefined);
        return true;
      }
    }
    return false;
  } finally {
    reader.releaseLock();
  }
}
