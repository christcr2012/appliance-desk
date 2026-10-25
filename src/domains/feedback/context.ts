// MCP-10a: the only page context an app-feedback report captures. Pure (no database), so it is simple to test.
// No full URL, query, hash, cookies, page content or logs are ever captured: only the page's shape (with record ids
// replaced by "[id]"), a coarse browser family, a device class and the app language.

export type FeedbackBrowser = "chrome" | "safari" | "firefox" | "edge" | "other";
export type FeedbackDevice = "phone" | "tablet" | "computer";
export type FeedbackLanguage = "en" | "es";
export type FeedbackSafeContext = { language: FeedbackLanguage; browser: FeedbackBrowser; device: FeedbackDevice };

const MAX_TEMPLATE = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_TOKEN = /^[A-Za-z0-9_-]{16,}$/;
const DIGITS = /^\d+$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_.\-[\]]+$/;

/** Turns the page a person was on into a safe template, e.g. "/account/rentals/ck123…?x=1#y" → "/account/rentals/[id]". */
export function toRouteTemplate(path: unknown): string {
  if (typeof path !== "string") return "/";
  let value = path.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  value = value.split("#")[0]!.split("?")[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  if (/[\\\x00-\x1f\x7f]/.test(decoded)) return "/";
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) return "/";
  const safe = segments.map((segment) =>
    UUID.test(segment) || DIGITS.test(segment) || LONG_TOKEN.test(segment) ? "[id]" : segment,
  );
  // Anything that still contains unusual characters (spaces, an email address, quotes) is not a known page shape.
  if (safe.some((segment) => !SAFE_SEGMENT.test(segment))) return "/";
  // Only this app's own pages: the desk, the customer portal, signing pages and the public website. Background
  // addresses (api, Next.js files) are never a page a person was looking at.
  if (["api", "_next"].includes(safe[0] ?? "")) return "/";
  const template = "/" + safe.join("/");
  return template.length > MAX_TEMPLATE ? template.slice(0, MAX_TEMPLATE) : template;
}

/** Coarse buckets only; the raw user-agent text is never stored. */
export function browserFromUserAgent(userAgent: string | null | undefined): FeedbackBrowser {
  const ua = userAgent ?? "";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "safari";
  return "other";
}

export function deviceFromUserAgent(userAgent: string | null | undefined): FeedbackDevice {
  const ua = userAgent ?? "";
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "phone";
  return "computer";
}

export function safeContextFrom(userAgent: string | null | undefined, language: string | null | undefined): FeedbackSafeContext {
  return {
    language: language === "es" ? "es" : "en",
    browser: browserFromUserAgent(userAgent),
    device: deviceFromUserAgent(userAgent),
  };
}

/** First 12 characters of the deployed commit, or null when not deployed (local runs). */
export function appRevisionFrom(sha: string | null | undefined): string | null {
  const value = (sha ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 12).toLowerCase() : null;
}

const BROWSER_WORDS: Record<FeedbackBrowser, string> = {
  chrome: "Chrome", safari: "Safari", firefox: "Firefox", edge: "Edge", other: "a web browser",
};
const DEVICE_WORDS: Record<FeedbackDevice, string> = { phone: "a phone", tablet: "a tablet", computer: "a computer" };

const AREA_WORDS: Record<string, string> = {
  desk: "Desk", account: "My account", sign: "Signing", rentals: "Rentals", agreements: "Rentals",
  maintenance: "Repairs", billing: "Billing", settings: "Settings", customers: "Customers", leads: "Leads",
  estimates: "Quotes", dispatch: "Schedule", jobs: "Jobs", inventory: "Equipment", today: "Today", tasks: "Tasks",
  communications: "Communications", "sales-tax": "Taxes", books: "Books", properties: "Properties", feedback: "App feedback",
};

/** "Rentals › a rental" style words for a template, for the "What we'll also see" box and the owner's report page. */
export function describeRouteTemplate(template: string): string {
  const segments = template.split("/").filter(Boolean);
  if (segments.length === 0) return "Website home";
  const words: string[] = [];
  for (const segment of segments) {
    if (segment === "[id]") {
      words.push("a record");
      continue;
    }
    const word = AREA_WORDS[segment] ?? segment.replace(/[-_]+/g, " ");
    if (words.at(-1) !== word) words.push(word);
  }
  return words.join(" › ");
}

export function describeSafeContext(context: FeedbackSafeContext): string {
  return `${BROWSER_WORDS[context.browser]} on ${DEVICE_WORDS[context.device]}`;
}

/** Reads a stored context defensively (older or hand-edited rows must never crash a page). */
export function readSafeContext(value: unknown): FeedbackSafeContext {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const browser = ["chrome", "safari", "firefox", "edge", "other"].includes(String(row.browser)) ? (row.browser as FeedbackBrowser) : "other";
  const device = ["phone", "tablet", "computer"].includes(String(row.device)) ? (row.device as FeedbackDevice) : "computer";
  return { language: row.language === "es" ? "es" : "en", browser, device };
}
