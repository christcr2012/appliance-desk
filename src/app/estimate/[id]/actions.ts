"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { approveEstimate, requestEstimateChanges } from "@/domains/estimates";
import { isRateLimited } from "@/lib/rate-limit";

// Same threat model and pattern as src/app/sign/[id]/actions.ts: a
// public, unauthenticated POST, gated by possession of the unguessable
// link rather than a login, so it gets the same per-IP throttle.
const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }; // 10 attempts / 10 min / IP

export type EstimateResponseState =
  | { status: "idle" }
  | { status: "approved" }
  | { status: "changes_requested" }
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
  if (isRateLimited(`estimate-respond:${ipAddress ?? "unknown"}`, RATE_LIMIT)) {
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
    return { status: "approved" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't approve this estimate.",
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
  if (isRateLimited(`estimate-respond:${ipAddress ?? "unknown"}`, RATE_LIMIT)) {
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
