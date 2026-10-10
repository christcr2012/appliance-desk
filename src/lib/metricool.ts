// Metricool's published be.js sends this image request. Build the same
// payload locally so private URLs/query values and referrer paths never leave.
const PUBLIC_PATHS = new Set([
  "/", "/pricing", "/how-it-works", "/service-area", "/contact", "/launch",
]);
const UTM_VALUES: Record<string, RegExp> = {
  utm_source: /^(facebook|instagram)$/,
  utm_medium: /^(organic_social|dm|profile)$/,
  utm_campaign: /^(prelaunch|prelaunch_oct2026)$/,
  utm_content: /^(post_0[1-9]|post_[1-4][0-9]|post_5[0-6]|laundry|property)$/,
};

export function metricoolConfig(runtime?: string, hash?: string, appUrl?: string) {
  if (runtime !== "production" || !hash || !/^[a-f0-9]{32}$/.test(hash) || !appUrl) return null;
  try {
    const site = new URL(appUrl);
    return site.protocol === "https:" ? { hash, siteOrigin: site.origin } : null;
  } catch { return null; }
}

export function metricoolVisit(input: {
  hash: string; siteOrigin: string; url: string; referrer: string;
  width: number; height: number; doNotTrack?: string | null; globalPrivacyControl?: boolean;
}): string | null {
  if (input.doNotTrack === "1" || input.globalPrivacyControl) return null;
  if (!/^[a-f0-9]{32}$/.test(input.hash)) return null;
  try {
    const page = new URL(input.url);
    if (page.protocol !== "https:" || page.origin !== input.siteOrigin ||
        !PUBLIC_PATHS.has(page.pathname)) return null;
    const safe = new URL(page.pathname, page.origin);
    for (const [key, allowed] of Object.entries(UTM_VALUES)) {
      const value = page.searchParams.get(key);
      // Fixed campaign labels only: never email, phone, tokens, free text.
      if (value && allowed.test(value)) safe.searchParams.set(key, value);
    }
    const pixel = new URL("https://tracker.metricool.com/c3po.jpg");
    pixel.searchParams.set("hash", input.hash);
    pixel.searchParams.set("u", safe.href);
    pixel.searchParams.set("bw", String(Math.max(0, Math.floor(input.width))));
    pixel.searchParams.set("bh", String(Math.max(0, Math.floor(input.height))));
    if (input.referrer) {
      const ref = new URL(input.referrer);
      if (ref.protocol === "https:" || ref.protocol === "http:") pixel.searchParams.set("ref", ref.origin);
    }
    return pixel.href;
  } catch { return null; }
}
