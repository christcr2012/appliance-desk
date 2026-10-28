// AR-4a (RENTALS spec section 5): why a rental ended. The owner keeps a list
// of reasons (a BusinessSettings JSON list with common starting values);
// every path that ends a rental for good may record one — never required,
// never shown to the customer. AR-9's "why customers left" reads the stored
// fields.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { lockRentalAgreementInTx } from "./index";

export const RECOMMENDED_END_REASONS = [
  "Moving away",
  "Bought their own",
  "Price",
  "Not happy with the service",
  "Didn't need it anymore",
  "Property sold or tenant left",
] as const;

export const END_REASON_OTHER = "Other";
export const END_REASON_NOTE_MAX = 200;

export function readEndReasonsValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [...RECOMMENDED_END_REASONS];
  const list = value.filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return list.length > 0 ? list : [...RECOMMENDED_END_REASONS];
}

export async function getRentalEndReasons(): Promise<string[]> {
  const s = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { rentalEndReasons: true },
  });
  return readEndReasonsValue(s?.rentalEndReasons);
}

/** Owner-only, audited, compare-and-set (the ending-notice pattern). */
export async function saveRentalEndReasons(
  actorId: string,
  reasons: string[],
  expected: string[],
): Promise<void> {
  const cleaned = reasons.map((r) => r.trim()).filter(Boolean);
  if (cleaned.length === 0) throw new Error("Keep at least one reason on the list.");
  if (cleaned.some((r) => r.length > 80)) {
    throw new Error("Each reason must be 80 characters or fewer.");
  }
  if (new Set(cleaned).size !== cleaned.length) {
    throw new Error("Each reason can appear only once.");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER"]);
    const changed = await tx.businessSettings.updateMany({
      where: {
        id: "singleton",
        rentalEndReasons: { equals: expected as Prisma.InputJsonValue },
      },
      data: { rentalEndReasons: cleaned as Prisma.InputJsonValue },
    });
    if (changed.count !== 1) {
      throw new Error("This setting was changed in another session. Reload before saving.");
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "agreement.end_reasons.update",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { rentalEndReasons: expected },
        newValue: { rentalEndReasons: cleaned },
      },
    });
  });
}

export type EndReasonInput = { reason: string | null; note: string | null };

/** Validate a submitted reason against the owner's list. Empty = no answer
 * (always allowed — the question is optional). Throws on a made-up reason. */
export function parseEndReasonInput(
  rawReason: string | null | undefined,
  rawNote: string | null | undefined,
  allowed: string[],
): EndReasonInput {
  const reason = (rawReason ?? "").trim();
  const note = (rawNote ?? "").trim().slice(0, END_REASON_NOTE_MAX);
  if (!reason) return { reason: null, note: null };
  if (reason !== END_REASON_OTHER && !allowed.includes(reason)) {
    throw new Error("Pick one of the reasons on the list, or Other.");
  }
  return { reason, note: note || null };
}

/** Record (or clear, when input is empty) why a rental ended. Locks the
 * agreement row and re-checks the actor, per the repo's write rules. */
export async function recordAgreementEndReason(
  actorId: string,
  agreementId: string,
  input: EndReasonInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
    const agreement = await lockRentalAgreementInTx(tx, agreementId);
    await tx.rentalAgreement.update({
      where: { id: agreementId },
      data: { endReason: input.reason, endReasonNote: input.note },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "agreement.end_reason_set",
        entityType: "RentalAgreement",
        entityId: agreementId,
        oldValue: {
          endReason: agreement.endReason,
          endReasonNote: agreement.endReasonNote,
        },
        newValue: { endReason: input.reason, endReasonNote: input.note },
      },
    });
  });
}
