"use server";

import { headers } from "next/headers";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { checkServiceArea } from "@/domains/site-content/service-area-check";
import { isRateLimited } from "@/lib/rate-limit";

/** What the home page shows after a check. Nothing here is stored: the address lives only in the visitor's own form. */
export type AddressCheckState =
  | { status: "idle" }
  | { status: "SERVED" | "NOT_YET"; zip: string; line1: string }
  | { status: "INVALID" }
  | { status: "LIMITED" };

const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

/**
 * V-6: the home page's "do you deliver to me?" check. Uses only the owner's service-area lists from Settings, makes
 * no outside call, and neither saves nor logs the address (the address is read from the form, answered and dropped).
 * Limited per visitor with the shared limiter, like the quote form.
 */
export async function checkServiceAddress(_previous: AddressCheckState, formData: FormData): Promise<AddressCheckState> {
  const line1 = String(formData.get("line1") ?? "").slice(0, 200);
  const zip = String(formData.get("zip") ?? "").slice(0, 20);
  if (String(formData.get("website") ?? "") !== "") return { status: "INVALID" };

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? "unknown";
  if (await isRateLimited(`address-check:${ip}`, RATE_LIMIT)) return { status: "LIMITED" };

  const result = checkServiceArea({ line1, zip }, parseServiceArea(await getBusinessSettings()));
  if (result.status === "INVALID" || !result.zip) return { status: "INVALID" };
  return { status: result.status, zip: result.zip, line1: line1.replace(/\s+/g, " ").trim() };
}
