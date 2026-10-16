"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { approveEstimate, requestEstimateChanges } from "@/domains/estimates";
import { createDepositCheckoutSessionForEstimate } from "@/domains/billing/checkout";
import { isRateLimited } from "@/lib/rate-limit";

const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

export type EstimateResponseState =
  | { status: "idle" }
  | { status: "approved" }
  | { status: "changes_requested" }
  | { status: "declined" }
  | { status: "redirecting"; url: string }
  | { status: "error"; message: string };

const approveSchema = z.object({
  deliverySelection: z.object({
    optionId:z.string().uuid(),expectedOfferVersion:z.number().int().min(1),
    questions:z.object({
      dryerOutlet:z.enum(["THREE_PRONG","FOUR_PRONG","GAS","UNKNOWN"]),
      stairs:z.boolean(),washerHookups:z.enum(["YES","NO","UNKNOWN"]),
      crewNotes:z.string().trim().max(1500),
    }),
  }).optional(),
  expectedQuoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/, "Refresh the reviewed all-in offer before approving."),
  approverName: z.string().trim().min(1, "Enter your full name.").max(200),
  approverEmail: z.string().trim().email("Enter a valid email address.").max(200),
});

async function getIp(): Promise<string | null> {
  const headerList = await headers();
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    null
  );
}

export async function approveEstimateAction(
  estimateId: string,
  raw: Record<string, unknown>,
): Promise<EstimateResponseState> {
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  const ipAddress = await getIp();
  if (
    await isRateLimited(
      `estimate-respond:${ipAddress ?? "unknown"}`,
      RATE_LIMIT,
    )
  ) {
    return {
      status: "error",
      message: "Too many attempts from this connection recently — please wait a few minutes and try again.",
    };
  }

  try {
    await approveEstimate(estimateId, {
      expectedQuoteFingerprint: parsed.data.expectedQuoteFingerprint,
      approverName: parsed.data.approverName,
      approverEmail: parsed.data.approverEmail,
      deliverySelection: parsed.data.deliverySelection,
      ipAddress,
    });
    const checkoutUrl = await createDepositCheckoutSessionForEstimate(estimateId);
    if (checkoutUrl) {
      return { status: "redirecting", url: checkoutUrl };
    }
    return { status: "approved" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't approve this estimate.",
    };
  }
}

export async function payEstimateDepositAction(
  estimateId: string,
): Promise<EstimateResponseState> {
  const ipAddress = await getIp();
  if (
    await isRateLimited(
      `estimate-respond:${ipAddress ?? "unknown"}`,
      RATE_LIMIT,
    )
  ) {
    return {
      status: "error",
      message: "Too many attempts from this connection recently — please wait a few minutes and try again.",
    };
  }

  try {
    const checkoutUrl = await createDepositCheckoutSessionForEstimate(estimateId);
    if (!checkoutUrl) {
      return { status: "approved" };
    }
    return { status: "redirecting", url: checkoutUrl };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't start the deposit payment.",
    };
  }
}

const changesSchema = z.object({
  message: z.string().trim().min(1, "Let us know what you'd like changed.").max(2000),
});

export async function requestEstimateChangesAction(
  estimateId: string,
  raw: Record<string, unknown>,
): Promise<EstimateResponseState> {
  const parsed = changesSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  const ipAddress = await getIp();
  if (
    await isRateLimited(
      `estimate-respond:${ipAddress ?? "unknown"}`,
      RATE_LIMIT,
    )
  ) {
    return {
      status: "error",
      message: "Too many attempts from this connection recently — please wait a few minutes and try again.",
    };
  }

  try {
    await requestEstimateChanges(estimateId, parsed.data.message);
    return { status: "changes_requested" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't send that.",
    };
  }
}

const declineSchema=z.object({reason:z.string().trim().max(1000)});
export async function declineEstimateAction(estimateId:string,raw:unknown):Promise<EstimateResponseState> {
  const parsed=declineSchema.safeParse(raw);
  if(!parsed.success)return{status:"error",message:"Invalid decline reason."};
  const ip=await getIp();
  if(await isRateLimited("estimate-decline:"+(ip??"unknown"),RATE_LIMIT))
    return{status:"error",message:"Too many attempts; please try again later."};
  try {
    const { declineOfferedEstimate }=await import("@/domains/orders/delivery-response");
    await declineOfferedEstimate(estimateId,parsed.data.reason);
    return{status:"declined"};
  }catch(error){return{status:"error",message:error instanceof Error?error.message:"Couldn't decline."};}
}
