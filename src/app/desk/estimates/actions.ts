"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createEstimateDraft,
  addEstimateLineItem,
  removeEstimateLineItem,
  sendEstimate,
  convertEstimateToAgreements,
} from "@/domains/estimates";
import { dollarsToCents } from "@/domains/pricing";

export type EstimateActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const newEstimateSchema = z.object({
  customerId: z.string().trim().min(1, "Choose a customer."),
  title: z.string().trim().min(1, "Give this estimate a short internal title.").max(200),
  clientMessage: z.string().trim().max(2000).optional().or(z.literal("")),
  internalNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  depositDollars: z.coerce.number().min(0).max(100000).optional(),
  validUntil: z.string().trim().optional().or(z.literal("")),
});

export async function createEstimateAction(
  raw: Record<string, unknown>,
): Promise<{ status: "success"; estimateId: string } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newEstimateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  let estimate;
  try {
    estimate = await createEstimateDraft(session.user.id, {
      customerId: data.customerId,
      title: data.title,
      clientMessage: data.clientMessage || undefined,
      internalNotes: data.internalNotes || undefined,
      depositCents: data.depositDollars ? dollarsToCents(data.depositDollars) : 0,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't create this estimate.",
    };
  }

  revalidatePath("/desk/estimates");
  redirect(`/desk/estimates/${estimate.id}`);
}

const newLineItemSchema = z.object({
  serviceAddressId: z.string().trim().optional().or(z.literal("")),
  description: z.string().trim().min(1, "Enter a description.").max(200),
  quantity: z.coerce.number().int().min(1).max(500),
  monthlyPriceDollars: z.coerce.number().min(0).max(100000).optional(),
  oneTimeFeeDollars: z.coerce.number().min(0).max(100000).optional(),
});

export async function addEstimateLineItemAction(
  estimateId: string,
  raw: Record<string, unknown>,
): Promise<EstimateActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newLineItemSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  try {
    await addEstimateLineItem(session.user.id, estimateId, {
      serviceAddressId: data.serviceAddressId || null,
      description: data.description,
      quantity: data.quantity,
      monthlyPriceCents: data.monthlyPriceDollars ? dollarsToCents(data.monthlyPriceDollars) : 0,
      oneTimeFeeCents: data.oneTimeFeeDollars ? dollarsToCents(data.oneTimeFeeDollars) : 0,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that line.",
    };
  }

  revalidatePath(`/desk/estimates/${estimateId}`);
  return { status: "success" };
}

export async function removeEstimateLineItemAction(
  estimateId: string,
  lineItemId: string,
): Promise<EstimateActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await removeEstimateLineItem(session.user.id, lineItemId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't remove that line.",
    };
  }

  revalidatePath(`/desk/estimates/${estimateId}`);
  return { status: "success" };
}

export async function sendEstimateAction(estimateId: string): Promise<EstimateActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await sendEstimate(session.user.id, estimateId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't send this estimate.",
    };
  }

  revalidatePath(`/desk/estimates/${estimateId}`);
  revalidatePath("/desk/estimates");
  return { status: "success" };
}

const convertSchema = z.union([
  z.object({ mode: z.literal("single"), serviceAddressId: z.string().trim().min(1) }),
  z.object({ mode: z.literal("per-property") }),
]);

export async function convertEstimateAction(
  estimateId: string,
  raw: Record<string, unknown>,
): Promise<{ status: "success"; agreementIds: string[] } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = convertSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Choose how to convert this estimate first." };
  }

  try {
    const agreementIds = await convertEstimateToAgreements(session.user.id, estimateId, parsed.data);
    revalidatePath(`/desk/estimates/${estimateId}`);
    revalidatePath("/desk/agreements");
    return { status: "success", agreementIds };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't convert this estimate.",
    };
  }
}
