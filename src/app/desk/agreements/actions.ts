"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createDraftAgreement,
  addRentalLine,
  removeRentalLine,
  sendForSignature,
  endAgreement,
  cancelAgreement,
} from "@/domains/agreements";
import { dollarsToCents } from "@/domains/pricing";

export type AgreementActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "success"; agreementId: string }
  | { status: "error"; message: string };

const newAgreementSchema = z.object({
  customerId: z.string().trim().min(1, "Choose a customer."),
  serviceAddressId: z.string().trim().min(1, "Choose a service address."),
  termMonths: z.string().trim().optional().or(z.literal("")),
  depositDollars: z.coerce.number().min(0).max(100000).optional(),
  damageWaiverDollars: z.coerce.number().min(0).max(100000).optional(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(60).optional(),
  lateFeeDollars: z.coerce.number().min(0).max(1000).optional(),
  lateFeePercent: z.coerce.number().min(0).max(100).optional(),
  taxRatePercent: z.coerce.number().min(0).max(20).optional(),
  paidInFullInAdvance: z.coerce.boolean().optional(),
});

export async function createDraftAgreementAction(
  raw: Record<string, unknown>,
): Promise<{ status: "success"; agreementId: string } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newAgreementSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  let agreement;
  try {
    agreement = await createDraftAgreement(session.user.id, {
      customerId: data.customerId,
      serviceAddressId: data.serviceAddressId,
      termMonths: data.termMonths ? parseInt(data.termMonths, 10) : null,
      depositCents: data.depositDollars ? dollarsToCents(data.depositDollars) : 0,
      damageWaiverCents: data.damageWaiverDollars
        ? dollarsToCents(data.damageWaiverDollars)
        : 0,
      lateFeeGraceDays: data.lateFeeGraceDays ?? 5,
      lateFeeCents: data.lateFeeDollars ? dollarsToCents(data.lateFeeDollars) : 0,
      lateFeePercent: data.lateFeePercent ?? 0,
      taxRatePermille: data.taxRatePercent ? Math.round(data.taxRatePercent * 10) : 0,
      paidInFullInAdvance: data.paidInFullInAdvance ?? false,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't create this agreement.",
    };
  }

  revalidatePath("/desk/agreements");

  return { status: "success", agreementId: agreement.id };
}

const newLineSchema = z.object({
  label: z.string().trim().min(1, "Enter a label for this line.").max(200),
  listPriceDollars: z.coerce.number().min(0).max(10000),
  applianceIds: z.array(z.string().trim().min(1)).min(1, "Choose at least one appliance."),
});

export async function addRentalLineAction(
  agreementId: string,
  raw: Record<string, unknown>,
): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newLineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  try {
    await addRentalLine(session.user.id, agreementId, {
      label: data.label,
      listPriceCents: dollarsToCents(data.listPriceDollars),
      applianceIds: data.applianceIds,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that line.",
    };
  }

  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  return { status: "success" };
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
      message: error instanceof Error ? error.message : "Couldn't remove that line.",
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
      message: error instanceof Error ? error.message : "Couldn't send this for signature.",
    };
  }

  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/activity");
  return { status: "success" };
}

export async function endAgreementAction(agreementId: string): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await endAgreement(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't end this agreement.",
    };
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}

export async function cancelAgreementAction(agreementId: string): Promise<AgreementActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await cancelAgreement(session.user.id, agreementId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't cancel this agreement.",
    };
  }
  revalidatePath(`/desk/agreements/${agreementId}`);
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/dashboard");
  return { status: "success" };
}
