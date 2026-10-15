import type { Prisma } from "@prisma/client";

/**
 * Agreement-owned history of a negotiated commercial refundable reserve.
 * RentalAgreement.depositCents stays the one amount source. This JSON is
 * terms/provenance, never a second wallet, invoice, or refund ledger.
 */
export type CommercialReserveRevision = {
  schemaVersion: 1;
  revision: number;
  agreementId: string;
  estimateId: string;
  amountCents: number;
  replenishment: "QUARTERLY" | "NONE";
  termsReference: string;
  reason: string;
  approvedByUserId: string;
  recordedAt: string;
  professionalReview: "REVIEW_REQUIRED";
};
export type ProposedReserveAllocation = {
  agreementId: string;
  amountCents: number;
  termsReference: string;
  replenishment: "QUARTERLY" | "NONE";
};
const cents = (n: unknown): n is number => typeof n === "number" &&
  Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000;
const id = (n: unknown): n is string =>
  typeof n === "string" && n.length > 0 && n.length <= 256;
const utc = (n: unknown): n is string =>
  typeof n === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(n) &&
  Number.isFinite(Date.parse(n)) && new Date(n).toISOString() === n;
export function validateCommercialReserveProposal(value: unknown): ProposedReserveAllocation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Review the proposed reserve for every prepared agreement.");
  const row = value as Record<string,unknown>;
  if (!id(row.agreementId) || !cents(row.amountCents) ||
      typeof row.termsReference !== "string" ||
      row.termsReference.trim().length < 12 || row.termsReference.length > 500 ||
      !["QUARTERLY","NONE"].includes(String(row.replenishment)))
    throw new Error("Provide a valid amount, terms reference and reserve replenishment decision.");
  if (row.amountCents === 0 && row.replenishment !== "NONE")
    throw new Error("A zero reserve cannot have automatic replenishment.");
  return {
    agreementId:row.agreementId,amountCents:row.amountCents,
    replenishment:row.replenishment as ProposedReserveAllocation["replenishment"],
    termsReference:row.termsReference.trim(),
  };
}
/** Non-empty corrupted history must block changes; never overwrite it. */
export function readCommercialReserveHistory(raw: unknown): CommercialReserveRevision[] {
  if (!Array.isArray(raw) || raw.length > 256)
    throw new Error("Commercial reserve history needs finance review.");
  const result: CommercialReserveRevision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("Commercial reserve history needs finance review.");
    const row = item as Record<string,unknown>;
    if (row.schemaVersion !== 1 || row.revision !== result.length + 1 ||
        !id(row.agreementId) || !id(row.estimateId) ||
        !id(row.approvedByUserId) || !utc(row.recordedAt) ||
        row.professionalReview !== "REVIEW_REQUIRED" ||
        typeof row.reason !== "string" || row.reason.trim().length < 12 ||
        row.reason.length > 500)
      throw new Error("Commercial reserve history needs finance review.");
    validateCommercialReserveProposal(row);
    result.push(row as unknown as CommercialReserveRevision);
  }
  return result;
}
export function nextCommercialReserveRevision(input: {
  previous: unknown; agreementId: string; estimateId: string;
  amountCents: number; replenishment: ProposedReserveAllocation["replenishment"];
  termsReference: string; actorUserId: string; reason: string; recordedAt: Date;
}): { versions: Prisma.InputJsonValue; current: CommercialReserveRevision; changed: boolean } {
  const old = readCommercialReserveHistory(input.previous);
  if (old.length === 256 || !id(input.estimateId) || !id(input.actorUserId) ||
      !utc(input.recordedAt.toISOString()) ||
      !id(input.agreementId) ||
      typeof input.reason !== "string" || input.reason.trim().length < 12 ||
      input.reason.length > 500)
    throw new Error("Record an attributable owner reserve revision with a reason.");
  const proposal = validateCommercialReserveProposal(input);
  if (old.some(row => row.agreementId !== input.agreementId || row.estimateId !== input.estimateId))
    throw new Error("Existing reserve history does not belong to this exact agreement.");
  const latest = old.at(-1);
  if (latest && latest.amountCents === proposal.amountCents &&
      latest.termsReference === proposal.termsReference &&
      latest.replenishment === proposal.replenishment) {
    return { versions: old as unknown as Prisma.InputJsonValue,
      current: latest, changed: false };
  }
  const current: CommercialReserveRevision = {
    schemaVersion:1,revision:old.length+1,
    agreementId:input.agreementId,estimateId:input.estimateId,
    amountCents:proposal.amountCents,replenishment:proposal.replenishment,
    termsReference:proposal.termsReference,reason:input.reason.trim(),
    approvedByUserId:input.actorUserId,recordedAt:input.recordedAt.toISOString(),
    professionalReview:"REVIEW_REQUIRED",
  };
  return { versions:[...old,current] as unknown as Prisma.InputJsonValue,current,changed:true };
}
