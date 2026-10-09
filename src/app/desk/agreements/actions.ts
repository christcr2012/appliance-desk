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
  lateFeeGraceDays: z.coerce.number().int().min(0).max(60).optional(),
  lateFeeDollars: z.coerce.number().min(0).max(1000).optional(),
  lateFeePercent: z.coerce.number().min(0).max(100).optional(),
  paidInFullInAdvance: z.boolean().optional(),
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
      lateFeeGraceDays: data.lateFeeGraceDays ?? 5,
      lateFeeCents: data.lateFeeDollars
        ? dollarsToCents(data.lateFeeDollars)
        : 0,
      lateFeePercent: data.lateFeePercent ?? 0,
      paidInFullInAdvance: data.paidInFullInAdvance ?? false,
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
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
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
export async function endMonthToMonthForCustomerAction(formData: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const agreementId = String(formData.get("agreementId") ?? "");
  const earlier = String(formData.get("earlierEffectiveOn") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const quote = await getMonthToMonthEndQuote(agreementId);
  if (!quote) throw new Error("This rental can't be ended this way right now.");
  await requestMonthToMonthEnd({ userId: session.user.id, kind: "team" }, agreementId, quote, {
    ...(earlier ? { earlierEffectiveOn: new Date(earlier), reason } : {}),
  });
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
    await applyEarlyReturn(session.user.id, agreementId, choice, parsePreview(String(formData.get("preview") ?? "")));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    failure = message && message.length < 300 && !message.includes("prisma") ? message : "That could not be saved. Please try again.";
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/today");
  redirect(failure ? `${base}?error=${encodeURIComponent(failure)}` : `${base}?done=1`);
}
