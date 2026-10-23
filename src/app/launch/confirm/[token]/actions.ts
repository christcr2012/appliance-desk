"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { confirmLaunchSubscription } from "@/domains/launch";
import { isRateLimited } from "@/lib/rate-limit";

const CONFIRM_RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };

/**
 * Confirming happens only when the person presses the button (a POST), never
 * on simply opening the link, because email security scanners open every link
 * in a message and would otherwise "confirm" people who never asked.
 */
export async function confirmLaunchAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
  const limited = await isRateLimited(`launch-confirm:${ip}`, CONFIRM_RATE_LIMIT);
  const confirmed = limited ? false : await confirmLaunchSubscription(token);
  redirect(`/launch/confirm/${encodeURIComponent(token)}?result=${confirmed ? "ok" : "failed"}`);
}
