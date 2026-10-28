"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createDraftAgreement,
  addRentalLine,
  removeRentalLine,
  sendForSignature,
  endAgreement,
  cancelAgreement,
  extendReservation,
} from "@/domains/agreements";
import { dollarsToCents } from "@/domains/pricing";
import { getMonthToMonthEndQuote, requestMonthToMonthEnd } from "@/domains/agreements/month-to-month";
import {
  getRentalEndReasons,
  parseEndReasonInput,
  recordAgreementEndReason,
} from "@/domains/agreements/end-reasons";

/** AR-4a: record the optional "Why is it ending?" answer, when one was given. */
/**
 * Validates the optional why-it-ended fields WITHOUT writing anything, so a
 * caller can run it BEFORE the ending itself: a reason the owner has since
 * taken off the list then fails fast, before any money or state moves,
 * instead of surfacing as a failed save after the ending already committed
 * (Codex review, PR #722).
 */
async function parseEndReasonFromForm(
  formData: FormData,
): Promise<ReturnType<typeof parseEndReasonInput> | null> {
  const rawReason = formData.get("endReason");
  if (typeof rawReason !== "string" || !rawReason.trim()) return null;
  const allowed = await getRentalEndReasons();
  const rawNote = formData.get("endReasonNote");
  return parseEndReasonInput(
    rawReason,
    typeof rawNote === "string" ? rawNote : null,
    allowed,
  );
}

async function recordEndReasonFromForm(
  userId: string,
  agreementId: string,
  formData: FormData,
): Promise<void> {
  const input = await parseEndReasonFromForm(formData);
  if (input) await recordAgreementEndReason(userId, agreementId, input);
}

async function recordParsedEndReason(
  userId: string,
  agreementId: string,
  input: ReturnType<typeof parseEndReasonInput> | null,
): Promise<void> {
  if (input) await recordAgreementEndReason(userId, agreementId, input);
}

export type AgreementActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "success"; agreementId: string; agreementStatus: string }
  | { status: "error"; message: string };

const newAgreementSchema = z.object({
  requestKey: z.uuid().optional(),
  customerId: z.string().trim().min(1, "Choose a customer."),
  serviceAddressId: z.string().trim().min(1, "Choose a service address."),
  termMonths: z
    .string()
    .trim()
    .regex(/^(?:|[1-9]\d*)$/, "Enter a whole number of months, or leave blank.")
    .refine((v) => !v || Number(v) <= 2147483647, "Term is too large.")
    .optional(),
  depositDollars: z.coerce.number().min(0).max(100000).optional(),
  damageWaiverDollars: z.coerce.number().min(0).max(100000).optional(),
  lateFeeGraceDays: z.coerce.number().int().min(10, "Colorado's rule: at least 10 days.").max(60).optional(),
  lateFeeDollars: z.coerce.number().min(0).max(15, "A late fee can be at most $15.").optional(),
  lateFeePercent: z.coerce.number().min(0).max(100).optional(),
  paidInFullInAdvance: z.boolean().optional(),
  overrideReason: z.string().trim().max(500).optional(),
});

export async function createDraftAgreementAction(
  raw: Record<string, unknown>,
): Promise<
  | { status: "success"; agreementId: string; agreementStatus: string }
  | { status: "error"; message: string }
> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newAgreementSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  let agreement;
  try {
    agreement = await createDraftAgreement(session.user.id, {
      requestKey: data.requestKey,
      customerId: data.customerId,
      serviceAddressId: data.serviceAddressId,
      termMonths: data.termMonths ? parseInt(data.termMonths, 10) : null,
      depositCents: data.depositDollars
        ? dollarsToCents(data.depositDollars)
        : 0,
      damageWaiverCents: data.damageWaiverDollars
        ? dollarsToCents(data.damageWaiverDollars)
        : 0,
      // DEC-2: a box the form leaves out takes its value from Settings; a box the person cleared is zero.
      lateFeeGraceDays: data.lateFeeGraceDays,
      lateFeeCents: data.lateFeeDollars === undefined
        ? undefined
        : data.lateFeeDollars
          ? dollarsToCents(data.lateFeeDollars)
          : 0,
      lateFeePercent: data.lateFeePercent,
      paidInFullInAdvance: data.paidInFullInAdvance ?? false,
      overrideReason: data.overrideReason,
    });
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Couldn't create this agreement.",
    };
  }

  revalidatePath("/desk/agreements");

  return {
    status: "success",
    agreementId: agreement.id,
    agreementStatus: agreement.status,
  };
}

const newLineSchema = z.object({
  label: z.string().trim().min(1, "Enter a label for this line.").max(200),
  listPriceDollars: z.coerce.number().min(0).max(10000),
  applianceIds: z
    .array(z.string().trim().min(1))
    .min(1, "Choose at least one appliance."),
  packageId: z.string().trim().max(100).optional().nullable(),
});

export async function addRentalLineAction(
  agreementId: string,
  raw: Record<string, unknown>,
): Promise<
  | {
      status: "success";
      line: { id: string; label: string; monthlyPriceCents: number };
    }
  | { status: "error"; message: string }
> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newLineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  let line;
  try {
    line = await addRentalLine(session.user.id, agreementId, {
      label: data.label,
      listPriceCents: dollarsToCents(data.listPriceDollars),
      applianceIds: data.applianceIds,
      packageId: data.packageId || null,
    });
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't add that line.",
    };
  }

  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  return {
    status: "success",
    line: {
      id: line.id,
      label: line.label,
      monthlyPriceCents: line.monthlyPriceCents,
    },
  };
}

export async function removeRentalLineAction(
  agreementId: string,
  lineId: string,
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await removeRentalLine(session.user.id, lineId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't remove that line.",
    };
  }

  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  return { status: "success" };
}

export async function sendForSignatureAction(
  agreementId: string,
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await sendForSignature(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Couldn't send this for signature.",
    };
  }

  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/activity");
  return { status: "success" };
}

export async function endAgreementAction(
  agreementId: string,
  endReason?: { reason?: string | null; note?: string | null },
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    if (endReason?.reason?.trim()) {
      const allowed = await getRentalEndReasons();
      const input = parseEndReasonInput(endReason.reason, endReason.note, allowed);
      await recordAgreementEndReason(session.user.id, agreementId, input);
    }
    await endAgreement(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't end this agreement.",
    };
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

export async function cancelAgreementAction(
  agreementId: string,
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    // Legacy server callers cannot bypass the reviewed cancellation flow.
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({
      where: { id: agreementId }, select: { firstDeliveredOn: true },
    });
    if (!agreement.firstDeliveredOn) throw new Error(
      "Use the before-delivery cancellation review to approve refund liabilities."
    );
    await cancelAgreement(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Couldn't cancel this agreement.",
    };
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

export async function extendReservationAction(
  agreementId: string,
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await extendReservation(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Couldn't extend this reservation.",
    };
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/agreements");
  return { status: "success" };
}

/** The owner or an admin ends a month-to-month rental for a customer, optionally on an earlier billing date. */
/**
 * AR-4a: the kit's form-action shape for Send for signature (record
 * header/next-step card). The kit runner surfaces a returned { error } as a
 * toast with the full message; throwing would reach the browser as a
 * redacted digest and the owner would never see why (PR #722, w22 spec).
 */
export async function sendForSignatureFormAction(formData: FormData) {
  const agreementId = String(formData.get("agreementId") ?? "");
  const result = await sendForSignatureAction(agreementId);
  return result.status === "error"
    ? { error: result.message }
    : { success: "Sent for signature" };
}

/** AR-4a: the kit's form-action shape for Extend the hold (record ⋯ menu). */
export async function extendReservationFormAction(formData: FormData) {
  const agreementId = String(formData.get("agreementId") ?? "");
  const result = await extendReservationAction(agreementId);
  return result.status === "error"
    ? { error: result.message }
    : { success: "Hold extended" };
}

/** AR-4a: the Details-tab editor — set or clear why a rental ended (owner/admin, audited). */
export async function setEndReasonAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(formData.get("agreementId") ?? "");
  const allowed = await getRentalEndReasons();
  const input = parseEndReasonInput(
    String(formData.get("endReason") ?? ""),
    String(formData.get("endReasonNote") ?? ""),
    allowed,
  );
  await recordAgreementEndReason(session.user.id, agreementId, input);
  revalidatePath(`/desk/agreements/${agreementId}`);
}

export async function endMonthToMonthForCustomerAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(formData.get("agreementId") ?? "");
  const earlier = String(formData.get("earlierEffectiveOn") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const quote = await getMonthToMonthEndQuote(agreementId);
  if (!quote) throw new Error("This rental can't be ended this way right now.");
  // Validate the optional why-it-ended answer before the ending moves money.
  const endReasonInput = await parseEndReasonFromForm(formData);
  await requestMonthToMonthEnd({ userId: session.user.id, kind: "team" }, agreementId, quote, {
    ...(earlier ? { earlierEffectiveOn: new Date(earlier), reason } : {}),
  });
  await recordParsedEndReason(session.user.id, agreementId, endReasonInput);
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/dashboard");
}

/** The owner confirms what happens to a rental whose equipment all came back early (B2-19). */
export async function confirmEarlyReturnAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(formData.get("agreementId") ?? "");
  const base = `/desk/agreements/${encodeURIComponent(agreementId)}/early-return`;
  let failure: string | null = null;
  try {
    const { choiceFromFields } = await import("@/domains/agreements/early-return-form");
    const { applyEarlyReturn, choiceFromSettings, parsePreview } = await import("@/domains/agreements/early-return");
    const { earlyReturnSettingsFrom } = await import("@/domains/settings/early-return");
    const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" } });
    const choice = choiceFromFields(
      {
        billing: String(formData.get("billing") ?? ""),
        unusedDays: String(formData.get("unusedDays") ?? ""),
        fee: String(formData.get("fee") ?? ""),
        feeDollars: String(formData.get("feeDollars") ?? ""),
        feeReason: String(formData.get("feeReason") ?? ""),
      },
      choiceFromSettings(earlyReturnSettingsFrom(settings)),
    );
    // Validate the optional why-it-ended answer before the return moves money.
    const endReasonInput = await parseEndReasonFromForm(formData);
    const preview = parsePreview(String(formData.get("preview") ?? ""));
    if (choice.unusedDays === "REFUND" && preview.refundOrCreditCents > 0) {
      // An early-return refund goes to the card like any other refund, so the same owner limit applies.
      const { assertRefundWithinLimit } = await import("@/domains/approvals");
      await assertRefundWithinLimit(session.user.id, preview.refundOrCreditCents);
    }
    await applyEarlyReturn(session.user.id, agreementId, choice, preview);
    await recordParsedEndReason(session.user.id, agreementId, endReasonInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failure = message && message.length < 300 && !message.includes("prisma") ? message : "That could not be saved. Please try again.";
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/today");
  redirect(failure ? `${base}?error=${encodeURIComponent(failure)}` : `${base}?done=1`);
}
