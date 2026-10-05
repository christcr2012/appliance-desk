"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { openPrivacyRequest } from "@/domains/privacy";

export async function publicPrivacyRequestAction(formData: FormData): Promise<never> {
  const kind = formData.get("kind");
  const email = String(formData.get("email") ?? "");
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipKey = forwarded || h.get("x-real-ip") || "unknown";

  try {
    if (kind !== "EXPORT" && kind !== "DELETE") throw new Error("Invalid request kind.");
    await openPrivacyRequest({ kind, email, ipKey });
  } catch {
    // Deliberately identical for unknown emails, delivery-off fallback, bad
    // input and rate-limited attempts. The public surface never confirms an account.
  }
  redirect("/privacy?request=received");
}
