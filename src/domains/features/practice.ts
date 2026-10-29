export function practiceAppUrl(env: { PRACTICE_APP_URL?: string; APP_ENV?: string }): string | null {
  if (env.APP_ENV === "testing" || !env.PRACTICE_APP_URL) return null;
  try {
    const url = new URL(env.PRACTICE_APP_URL);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.origin + url.pathname.replace(/\/$/, "") + url.search;
  } catch { return null; }
}
