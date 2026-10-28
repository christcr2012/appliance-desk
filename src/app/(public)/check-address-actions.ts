"use server";

import { headers } from "next/headers";
import { checkAddressZone, type PublicAddressCheck } from "@/domains/delivery/public-check";
import { isRateLimited } from "@/lib/rate-limit";

/**
 * What the address checker shows after a check. Nothing here is stored or logged: the address is read from the form,
 * sent once to the U.S. Census Bureau's address lookup, answered and dropped. Never includes a map position or miles.
 */
export type AddressCheckState = { status: "idle" } | PublicAddressCheck | { status: "LIMITED" };

const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

/**
 * ZONE-1 (replaces V-6's ZIP list check): "which delivery zone am I in?" on the home and service-area pages. Limited
 * per visitor with the shared limiter, like the quote form (best-effort only: see docs/AI-PR-READ-FIRST.md item 4).
 */
export async function checkServiceAddress(_previous: AddressCheckState, formData: FormData): Promise<AddressCheckState> {
  const line1 = String(formData.get("line1") ?? "").slice(0, 200);
  const zip = String(formData.get("zip") ?? "").slice(0, 20);
  if (String(formData.get("website") ?? "") !== "") return { status: "INVALID" };

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? "unknown";
  if (await isRateLimited(`address-check:${ip}`, RATE_LIMIT)) return { status: "LIMITED" };

  return checkAddressZone({ line1, zip });
}
