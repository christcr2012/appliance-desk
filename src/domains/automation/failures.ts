// MCP-1 spec section 4: typed failures. A job that stops records a code from this list, the step it stopped at and a
// random reference. Screens, system issues, emails and any future assistant output show only the plain explanation
// for the code — never the original error text, a provider's reply or an environment value.
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

export const FAILURE_CODES = {
  CONFIG_MISSING: {
    explain: "A setting this job needs is missing, so it could not start.",
    next: "Open the job's row on this page to see which setting name is missing, then ask whoever manages hosting to add it.",
    href: "/desk/automations",
  },
  PROVIDER_UNREACHABLE: {
    explain: "An outside service this job uses could not be reached.",
    next: "Nothing needs undoing. The job tries again at its next usual time; if it fails two days in a row, check the service's status page.",
  },
  PROVIDER_REFUSED: {
    explain: "An outside service this job uses said no to the request.",
    next: "Check that the service account is still active and its access is still set up, then wait for the next run.",
    href: "/desk/settings?section=integrations",
  },
  TIMEOUT: {
    explain: "The job ran out of time before it finished.",
    next: "Nothing needs undoing; work already saved stays saved. It tries again at its next usual time.",
  },
  DATABASE_BUSY: {
    explain: "The database was too busy to finish the job just then.",
    next: "Nothing needs undoing. It tries again at its next usual time; if it keeps happening, ask for the database size to be checked.",
  },
  DATA_PROBLEM: {
    explain: "A record the job reads did not look the way it expected.",
    next: "Ask for the job's reference number to be looked up in the server log before trying again.",
  },
  BACKUP_CAPTURE: {
    explain: "The backup could not read a complete copy of the business data.",
    next: "Your data is untouched. Watch tomorrow's run; if it fails again, ask for the backup to be checked.",
  },
  BACKUP_UPLOAD: {
    explain: "The backup copy could not be saved to private storage.",
    next: "Your data is untouched. Check that private storage is still set up, then watch tomorrow's run.",
  },
  BACKUP_READBACK: {
    explain: "The backup copy was saved but could not be read back to check it.",
    next: "Do not rely on today's copy. Watch tomorrow's run; if it fails again, ask for the backup to be checked.",
  },
  BACKUP_PRUNE: {
    explain: "Today's backup was saved, but old copies could not be cleared out.",
    next: "Nothing is lost. Storage may grow a little until the next run clears the old copies.",
  },
  MEDIA_STORE_NOT_READY: {
    explain: "The private photo store is not set up or could not be opened.",
    next: "Check the private photo storage setting names on this page, then wait for the next run.",
    href: "/desk/automations",
  },
  MEDIA_COPY: {
    explain: "Some private photos could not be copied for recovery.",
    next: "The photos themselves are untouched. Watch the next run; if it fails again, ask for the photo copy to be checked.",
  },
  UNCLASSIFIED: {
    explain: "The job stopped for a reason the app does not recognise.",
    next: "Give the reference number to whoever helps with the app so they can find the matching server log line.",
  },
} as const satisfies Record<string, { explain: string; next: string; href?: string }>;

export type FailureCode = keyof typeof FAILURE_CODES;
export const FAILURE_CODE_LIST = Object.keys(FAILURE_CODES) as FailureCode[];

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FAILURE_CODES, value);
}

/** What a screen shows for a stored code (old rows have none: "Not recorded"). */
export function failureExplanation(code: string | null | undefined): { code: FailureCode | null; explain: string; next: string; href: string | null } {
  if (!isFailureCode(code)) {
    return { code: null, explain: "Not recorded (this happened before the app kept a reason).", next: "Watch the next run.", href: null };
  }
  const item: { explain: string; next: string; href?: string } = FAILURE_CODES[code];
  return { code, explain: item.explain, next: item.next, href: item.href ?? null };
}

const STAGE = /^[a-z][a-z0-9-]{0,29}$/;

/** Throw this from a job to say exactly what failed and where. The message is never shown or stored. */
export class AutomationFailure extends Error {
  readonly code: FailureCode;
  readonly stage: string;
  constructor(code: FailureCode, stage: string, options?: { cause?: unknown }) {
    super(`Automation failure ${code} at ${stage}`, options);
    this.name = "AutomationFailure";
    if (!isFailureCode(code)) throw new Error("Unknown failure code.");
    if (!STAGE.test(stage)) throw new Error("Invalid failure stage.");
    this.code = code;
    this.stage = stage;
  }
}

const PROVIDER_REFUSED_NAMES = new Set([
  "StripeAuthenticationError", "StripePermissionError", "StripeInvalidRequestError", "StripeCardError",
  "StripeIdempotencyError", "StripeRateLimitError",
  "BlobAccessError", "BlobStoreNotFoundError", "BlobStoreSuspendedError", "BlobNotFoundError",
  "BlobFileTooLargeError", "BlobContentTypeNotAllowedError", "BlobPathnameMismatchError", "BlobClientTokenExpiredError",
]);
const PROVIDER_UNREACHABLE_NAMES = new Set([
  "StripeConnectionError", "StripeAPIError", "BlobServiceNotAvailable", "BlobServiceRateLimited", "BlobUnknownError",
  "FetchError",
]);
const TIMEOUT_NAMES = new Set(["AbortError", "TimeoutError", "ProviderTimeoutError"]);
const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
// Prisma: P1008 operations timed out, P2024 connection pool timeout, P2028 transaction API error, P2034 write conflict
// or deadlock (serialization). P1001/P1002 the database could not be reached / timed out reaching it.
const DATABASE_BUSY_PRISMA = new Set(["P1001", "P1002", "P1008", "P2024", "P2028", "P2034"]);

function nameOf(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const ctor = (cause as { constructor?: { name?: unknown } }).constructor?.name;
  const name = (cause as { name?: unknown }).name;
  return typeof name === "string" && name !== "Error" ? name : typeof ctor === "string" ? ctor : "";
}

/**
 * Map any thrown value to a code. An AutomationFailure keeps its own code; known database, timeout and provider
 * errors are recognised by class or code; everything else is UNCLASSIFIED (never guessed from the message).
 */
export function classifyFailure(cause: unknown): { code: FailureCode; stage: string | null } {
  if (cause instanceof AutomationFailure) return { code: cause.code, stage: cause.stage };
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    return { code: DATABASE_BUSY_PRISMA.has(cause.code) ? "DATABASE_BUSY" : "DATA_PROBLEM", stage: null };
  }
  if (cause instanceof Prisma.PrismaClientInitializationError) return { code: "DATABASE_BUSY", stage: null };
  if (cause instanceof Prisma.PrismaClientValidationError) return { code: "DATA_PROBLEM", stage: null };
  const name = nameOf(cause);
  if (TIMEOUT_NAMES.has(name)) return { code: "TIMEOUT", stage: null };
  if (PROVIDER_REFUSED_NAMES.has(name)) return { code: "PROVIDER_REFUSED", stage: null };
  if (PROVIDER_UNREACHABLE_NAMES.has(name)) return { code: "PROVIDER_UNREACHABLE", stage: null };
  const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : undefined;
  if (code === "ETIMEDOUT") return { code: "TIMEOUT", stage: null };
  if (typeof code === "string" && NETWORK_CODES.has(code)) return { code: "PROVIDER_UNREACHABLE", stage: null };
  return { code: "UNCLASSIFIED", stage: null };
}

/** A random, meaningless reference (10 letters/digits) printed on screen and on the private server log line. */
export function newCorrelationId(): string {
  return "ref-" + randomBytes(5).toString("hex");
}

export const CORRELATION_ID = /^ref-[0-9a-f]{10}$/;
export const FAILURE_STAGE = STAGE;
