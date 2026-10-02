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
  | { status: "redirecting"; url: string }
  | { status: "error"; message: string };

const approveSchema = z.object({
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
      approverName: parsed.data.approverName,
      approverEmail: parsed.data.approverEmail,
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
