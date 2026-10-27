/**
 * CMP-3 — the IRIS Application-to-Application (A2A) client, behind its
 * switch.
 *
 * Direct filing through IRIS A2A needs an A2A TCC, an API client id, and
 * passing the IRS Assurance Testing System (schema 5.0.7, Publication
 * 5718) — all owner checklist items. Until Chris has them, this client
 * stays OFF: `irisA2aStatus()` reports why, and `submitInformationReturn`
 * refuses. The portal CSV (iris-csv.ts) is the filing route meanwhile.
 *
 * The client is transport-injected so tests exercise the full request
 * building and response handling against Pub 5718-shaped fixtures with
 * no network. Amounts are dollars-and-cents strings, TINs are digits
 * only, exactly as the schema carries them.
 */

export interface IrisA2aConfig {
  enabled: boolean;
  tcc: string | null;
  clientId: string | null;
  endpoint: string | null;
  reason: string;
}

export function irisA2aStatus(env: NodeJS.ProcessEnv = process.env): IrisA2aConfig {
  const tcc = env.IRIS_A2A_TCC ?? null;
  const clientId = env.IRIS_A2A_CLIENT_ID ?? null;
  const endpoint = env.IRIS_A2A_ENDPOINT ?? null;
  if (env.IRIS_A2A_ENABLED !== "true") {
    return { enabled: false, tcc, clientId, endpoint, reason: "Direct filing through IRIS is switched off (IRIS_A2A_ENABLED). The portal CSV is the filing route." };
  }
  if (!tcc || !clientId || !endpoint) {
    return { enabled: false, tcc, clientId, endpoint, reason: "Direct filing is switched on but the A2A TCC, client id or endpoint is missing — see the owner checklist." };
  }
  return { enabled: true, tcc, clientId, endpoint, reason: "Ready." };
}

export interface A2aParty {
  tinType: "SSN" | "EIN";
  tinDigits: string;
  name: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
}

export interface A2aSubmission {
  formType: "1099-NEC" | "1099-MISC";
  taxYear: number;
  payer: A2aParty;
  recipient: A2aParty;
  /** Box amounts in cents, keyed by the form's box names ("box1", "box3", "box4"). */
  amountsCents: Record<string, number>;
  accountNumber?: string;
}

function partyJson(party: A2aParty): Record<string, unknown> {
  return {
    tinType: party.tinType,
    tin: party.tinDigits.replace(/[^0-9]/g, ""),
    name: party.name,
    address: {
      line1: party.addressLine1 ?? "",
      city: party.city ?? "",
      state: party.state ?? "",
      zip: party.zip ?? "",
      country: party.country,
    },
  };
}

/** The Pub 5718-shaped submission document for one information return. */
export function buildA2aPayload(submission: A2aSubmission, tcc: string): Record<string, unknown> {
  const amounts: Record<string, string> = {};
  for (const [box, cents] of Object.entries(submission.amountsCents)) {
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("A 1099 amount must be a non-negative number of cents.");
    amounts[box] = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  }
  return {
    schemaVersion: "5.0.7",
    transmission: { tcc, softwareId: "appliance-desk" },
    submission: {
      formType: submission.formType,
      taxYear: submission.taxYear,
      payer: partyJson(submission.payer),
      recipient: partyJson(submission.recipient),
      amounts,
      ...(submission.accountNumber ? { accountNumber: submission.accountNumber } : {}),
    },
  };
}

export type A2aTransport = (endpoint: string, payload: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;

export interface A2aResult {
  accepted: boolean;
  receiptId: string | null;
  errors: string[];
}

/** Parses an A2A response document (the shape the fixtures pin). */
export function parseA2aResponse(status: number, body: unknown): A2aResult {
  const doc = (body ?? {}) as { receiptId?: unknown; status?: unknown; errors?: unknown };
  const errors = Array.isArray(doc.errors) ? doc.errors.map((e) => String(e)) : [];
  if (status >= 200 && status < 300 && doc.status === "ACCEPTED" && typeof doc.receiptId === "string") {
    return { accepted: true, receiptId: doc.receiptId, errors: [] };
  }
  return {
    accepted: false,
    receiptId: typeof doc.receiptId === "string" ? doc.receiptId : null,
    errors: errors.length > 0 ? errors : [`The IRS service answered with status ${status} and did not accept the submission.`],
  };
}

/**
 * Submits one return through A2A. Refuses while the switch is off — this
 * is the only network path and it stays unused until the owner checklist
 * items (TCC, client id, ATS) are done and the switch is turned on.
 */
export async function submitInformationReturn(
  submission: A2aSubmission,
  transport: A2aTransport,
  env: NodeJS.ProcessEnv = process.env,
): Promise<A2aResult> {
  const config = irisA2aStatus(env);
  if (!config.enabled) throw new Error(config.reason);
  const payload = buildA2aPayload(submission, config.tcc!);
  const response = await transport(config.endpoint!, payload);
  return parseA2aResponse(response.status, response.body);
}
