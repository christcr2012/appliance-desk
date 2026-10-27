/** Turn Better Auth's JSON redirect envelope into a browser redirect for OAuth user agents. */
export async function oauthBrowserRedirect(request: Request, response: Response, issuer: string | null): Promise<Response> {
  if (!issuer || response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) {
    return response;
  }
  const payload: unknown = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== "object" || !("redirect" in payload) || payload.redirect !== true ||
      !("url" in payload) || typeof payload.url !== "string") return response;
  let url: URL;
  try { url = new URL(payload.url, issuer); }
  catch { return new Response("Invalid assistant authorization redirect.", { status: 400 }); }
  if (url.username || url.password || (!["https:", "http:"].includes(url.protocol)) ||
      (url.protocol === "http:" && !(process.env.NODE_ENV === "test" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
    return new Response("Invalid assistant authorization redirect.", { status: 400 });
  }
  const sameOrigin = url.origin === issuer;
  const approvedInternal = sameOrigin &&
    (url.pathname === "/connect/consent" || url.pathname === "/login" || url.pathname === "/sign-in");
  let callbackMatches = false;
  try {
    const redirectUri = new URL(new URL(request.url).searchParams.get("redirect_uri") ?? "");
    callbackMatches = redirectUri.origin === url.origin && redirectUri.pathname === url.pathname;
  } catch { /* no requested callback */ }
  if (!approvedInternal && !callbackMatches) {
    return new Response("Invalid assistant authorization redirect.", { status: 400 });
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  headers.set("Location", url.toString());
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 302, headers });
}
