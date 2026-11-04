/**
 * The published AI check-up contract — one source for what the ops API
 * enforces (ops-api.ts) and what the key hand-off block and the keyless
 * discovery document publish, so the two can never drift apart.
 *
 * Pure data and string building only: no database, no Node built-ins, so
 * the client-side key panel can import it too. Nothing in this module is
 * secret and nothing here grants access — the key stays the only
 * credential, and the discovery document stays public static text.
 */

export const OPS_NOTE_CATEGORIES = ["OWNER_ACTION", "CODE_FINDING", "QUESTION"] as const;
export type OpsNoteCategory = (typeof OPS_NOTE_CATEGORIES)[number];

export const OPS_RECOMMENDATIONS = {
  INVESTIGATE_CODE: "Review the affected code and reproduce the reported behavior with regression tests.",
  OWNER_CONFIGURATION: "Owner action: review the related settings; do not paste access credentials.",
  VERIFY_PROVIDER: "The provider outcome is uncertain. Reconcile durable provider evidence before retrying.",
  REVIEW_SOURCE: "Verify the official source manually before changing any business or tax setting.",
} as const;
export type OpsRecommendationKey = keyof typeof OPS_RECOMMENDATIONS;

/** Requests allowed per key per window; enforced by authorizeOpsRequest. */
export const OPS_RATE_LIMIT: { max: number; windowMs: number } = { max: 60, windowMs: 3_600_000 };

export const OPS_ISSUES_PATH = "/api/ops/issues";
export const OPS_DISCOVERY_PATH = "/api/ops";

const CATEGORY_MEANINGS: Record<OpsNoteCategory, string> = {
  OWNER_ACTION: "a person (the owner) needs to do something — review a setting, make a decision, check an outside account",
  CODE_FINDING: "the problem is in the app's own code — it belongs to the builders",
  QUESTION: "you cannot yet tell which of the other two it is; record what evidence would settle it",
};

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Derive the public origin of the deployment answering this request from
 * its host header. Returns null when the host is missing or not a plain
 * host name, so callers can fall back instead of publishing a bad address.
 * https everywhere except local development hosts.
 */
export function opsOriginFromHost(host: string | null): string | null {
  if (!host) return null;
  const candidate = host.split(",")[0]!.trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(candidate)) return null;
  const hostname = candidate.split(":")[0]!;
  if (!hostname.includes(".") && hostname !== "localhost") return null;
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  return `${local ? "http" : "https"}://${candidate}`;
}

/** The keyless discovery document served at GET /api/ops. */
export function opsDiscoveryDocument(baseUrl: string) {
  const base = cleanBaseUrl(baseUrl);
  return {
    service: "Appliance Desk — AI check-up API",
    version: 1,
    purpose:
      "A read-mostly window into the problems Appliance Desk is tracking about its own operation " +
      "(failed or stale automations, stuck provider operations, unreachable official sources, missing " +
      "tax periods, backups needing attention), plus one narrow write: a structured triage note on an " +
      "issue. An AI assistant uses it to run a check-up — read the open problems, sort each one, record " +
      "the sort, and report to the owner in plain words. It fixes nothing and changes nothing else.",
    baseUrl: base,
    discovery: {
      url: `${base}${OPS_DISCOVERY_PATH}`,
      authenticationRequired: false,
      note:
        "This document is public on purpose and contains no issue data and no key material. Fetch it " +
        "any time to re-learn the contract. The key below is the only credential the API uses.",
    },
    gettingAKey:
      "The owner creates a key in the app under Desk → Automations → “AI check-up keys”. The key is " +
      "shown once, at creation, together with a hand-off block containing everything in this document. " +
      "Keep the key in a private credential store; never post it, commit it or include it in an issue. " +
      "The owner can revoke a key at any time from the same panel, which cuts it off immediately.",
    authentication: {
      header: "Authorization",
      format: "Bearer <key>",
      appliesTo: `Every request to ${OPS_ISSUES_PATH} and its note endpoint. The discovery document itself needs no key.`,
      invalidKeyAnswer:
        "A missing, malformed, unknown or revoked key all get the same answer — HTTP 404 — so the API " +
        "never reveals whether a key exists.",
    },
    endpoints: [
      {
        method: "GET",
        path: OPS_ISSUES_PATH,
        url: `${base}${OPS_ISSUES_PATH}`,
        query: {
          limit: "Optional. Whole number 1–100; default 25.",
          cursor: "Optional. Pass the previous response's nextCursor to fetch the next page.",
        },
        response: {
          issues:
            "Array, newest activity first. Each issue has: id, kind (what sort of problem), severity, " +
            "status (OPEN, ACKNOWLEDGED or RESOLVED), version (a number that changes whenever the issue " +
            "changes — notes must quote it), summary, detail, occurrences (how many times it has " +
            "happened), firstSeenAt, lastSeenAt, resolvedAt (null while unresolved), failureCode and " +
            "failureExplanation (a plain-English explanation, present for automation failures only).",
          nextCursor: "The id to pass as cursor for the next page, or null when there are no more.",
        },
      },
      {
        method: "POST",
        path: `${OPS_ISSUES_PATH}/{issueId}/notes`,
        url: `${base}${OPS_ISSUES_PATH}/{issueId}/notes`,
        body: "A JSON object matching the note contract below — exactly those fields, no others. Free-text notes are deliberately not accepted; the app builds the note text from your choices.",
        response: "{ ok: true } on success. Recording a note on an OPEN issue also marks it ACKNOWLEDGED. A note never resolves an issue.",
      },
    ],
    noteContract: {
      fields: {
        category: `Exactly one of: ${OPS_NOTE_CATEGORIES.join(", ")}.`,
        recommendationKey: "Exactly one of the keys under recommendations. The app turns it into the fixed sentence shown there — you cannot write your own instruction.",
        codeReferences:
          "An array of at most 5 paths of files that already exist in the app's code repository, " +
          "relative like “src/…” or “docs/…”. Use it only for CODE_FINDING, and only when you actually " +
          "know the files; an empty array is fine. No web addresses.",
        expectedVersion: "The issue's current version number, copied from your read. If the issue changed in between, the note is refused with HTTP 409 — re-read the issue and retry only if the note still fits.",
        prUrl: "Optional. Only a pull-request address in the app's own GitHub repository (https://github.com/christcr2012/appliance-desk/pull/<number>).",
      },
      categories: { ...CATEGORY_MEANINGS },
      recommendations: { ...OPS_RECOMMENDATIONS },
    },
    rateLimit: {
      requests: OPS_RATE_LIMIT.max,
      window: "1 hour",
      per: "key",
      onLimit: "HTTP 429 with “Request limit reached.” — wait before calling again.",
    },
    errors: {
      "404": "The key is missing, wrong or revoked (deliberately indistinguishable), or the issue id does not exist.",
      "409": "The issue changed since you read it (expectedVersion no longer matches). Re-read and retry only if the note still fits.",
      "422": "The request does not match the contract — a bad limit or cursor, or a note with unknown fields, an unknown category or recommendationKey, too many code references, or a code reference that is not an existing repository file.",
      "429": "Rate limit reached for this key. Slow down.",
    },
    dataPolicy: {
      included:
        "Each problem's kind, severity, status, how many times it happened, when it was first and last " +
        "seen, a short summary and safe detail, and a plain-English explanation for automation failures.",
      deliberatelyExcluded:
        "No customer names or ids, no owner or staff notes, no user ids, no raw error logs or raw " +
        "provider failures, no key material or hashes. The check-up reports on the app's health, never " +
        "on the business's customers.",
    },
    theCheckupJob: [
      `Read the problem list: GET ${base}${OPS_ISSUES_PATH}?limit=25 with the Authorization header above. Follow nextCursor only when you need more.`,
      "For each open problem, decide which one category fits and record one structured note (POST above) with the matching recommendationKey.",
      "Report to the owner in plain words: what is new, what keeps coming back, what is aging untouched, and which items are theirs to act on.",
      "Never claim a problem is fixed because you noted it. Fixing belongs to the owner (settings) or the builders (code).",
    ],
  };
}

/** The one-paste hand-off block the key panel shows when a key is created. */
export function opsHandoffText(input: { baseUrl: string; key: string }): string {
  const base = cleanBaseUrl(input.baseUrl);
  const recommendations = (Object.entries(OPS_RECOMMENDATIONS) as Array<[OpsRecommendationKey, string]>)
    .map(([key, text]) => `  - ${key} → “${text}”`)
    .join("\n");
  const categories = OPS_NOTE_CATEGORIES
    .map((category) => `  - ${category} — ${CATEGORY_MEANINGS[category]}`)
    .join("\n");
  return [
    "AI CHECK-UP HAND-OFF — Appliance Desk (Robinson Appliance Rentals)",
    "",
    "You are an AI assistant asked to run check-ups on the Appliance Desk app. Everything you need is in this block.",
    "",
    `YOUR KEY (private — store it in a credential store, never post, commit or log it): ${input.key}`,
    `APP ADDRESS: ${base}`,
    `IF YOU EVER NEED THESE INSTRUCTIONS AGAIN: fetch GET ${base}${OPS_DISCOVERY_PATH} — no key needed for that page, and it never contains issue data or keys.`,
    "",
    "YOUR JOB — A CHECK-UP",
    "1. Read the app's problem list (below). The list holds problems the app tracks about its own operation: failed or stale automations, stuck provider operations, unreachable official sources, missing tax periods, backups needing attention.",
    "2. For each open problem, decide which single category fits and record one structured note (below). You cannot write free-text notes — the app builds the note text from your choices.",
    "3. Report to the owner in plain words: what is new, what keeps coming back, what is aging untouched, and which items need the owner personally.",
    "",
    "HOW TO CALL",
    `Read problems:  GET ${base}${OPS_ISSUES_PATH}?limit=25`,
    `Record a note:  POST ${base}${OPS_ISSUES_PATH}/<issue id>/notes`,
    `Every call sends the header:  Authorization: Bearer ${input.key}`,
    "The read answers { issues: [...], nextCursor }. Each issue has an id, kind, severity, status, a version number, a summary, how many times it happened (occurrences), and when it was first and last seen. Pass nextCursor back as ?cursor= to see more. Limit can be 1–100.",
    "",
    "HOW TO RECORD A NOTE",
    "Send a JSON body with exactly these fields:",
    "{",
    '  "category": "OWNER_ACTION",',
    '  "recommendationKey": "OWNER_CONFIGURATION",',
    '  "codeReferences": [],',
    '  "expectedVersion": 3',
    "}",
    "· category is exactly one of:",
    categories,
    "· recommendationKey is exactly one of the four below. The app turns it into the fixed sentence shown — you cannot write your own instruction:",
    recommendations,
    "· codeReferences: at most 5 paths of files that already exist in the app's code repository (like “src/…”), for CODE_FINDING only, and only when you actually know them. An empty list is fine. No web addresses.",
    "· expectedVersion: copy the issue's current version number from your read. If the issue changed in between you get HTTP 409 — re-read it and retry only if the note still fits.",
    "· prUrl (optional): only a pull-request address in the app's own GitHub repository.",
    "Recording a note on an OPEN problem marks it ACKNOWLEDGED. A note never fixes or resolves anything.",
    "",
    "LIMITS AND ANSWERS",
    `· ${OPS_RATE_LIMIT.max} requests per hour for this key. HTTP 429 means slow down and wait.`,
    "· HTTP 404 means the key is missing, wrong or revoked (the app will not say which) — tell the owner.",
    "· HTTP 422 means the request did not match this contract — check the fields above.",
    "",
    "WHAT YOU WILL NOT SEE, ON PURPOSE",
    "The list contains no customer names or ids, no owner notes, no raw error logs and no raw provider details — only each problem's kind, severity, status, counts, times, a short summary and, for automation failures, a plain-English explanation. You report and record; you never fix anything, change settings, or contact anyone.",
  ].join("\n");
}
