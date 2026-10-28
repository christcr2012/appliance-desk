/** The MCP issuer is never learned from an incoming request or a forwarded host. */
export function getMcpIssuer(): string | null {
  const raw = process.env.MCP_ISSUER_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localTest = process.env.NODE_ENV === "test" &&
      url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if ((!localTest && url.protocol !== "https:") || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Do not relax the plugin's registered callback match for an arbitrary URL. */
export function validateMcpRedirectUri(uri: string, registeredUris: readonly string[], matchesRegistration: boolean): boolean {
  if (!matchesRegistration) return false;
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      parsed.port !== "" && registeredUris.some((registered) => {
        try {
          const allowed = new URL(registered);
          return allowed.hostname === parsed.hostname && allowed.pathname === parsed.pathname;
        } catch { return false; }
      });
  } catch { return false; }
}
