"use server";

import { headers } from "next/headers";
import { createLead } from "@/domains/leads";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";
import { getPublishedApplianceTypes } from "@/domains/pricing";
import { isRateLimited } from "@/lib/rate-limit";

export type SubmitLeadState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

// Phase 6A item 7 — public form spam/abuse protection. Deliberately
// generous: this form is how real customers reach us, so the goal is
// blocking a script hammering the endpoint, not adding friction for a
// real visitor who's just slow to fill out a long form.
const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 }; // 5 submissions / 10 min / IP

export async function submitLead(
  raw: unknown,
): Promise<SubmitLeadState> {
  const parsed = leadFormSchemaForCatalog(false).safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields and try again.",
    };
  }

  // Honeypot: a real visitor never sees or fills this field (it's
  // hidden off-screen in contact-form.tsx) — anything here means an
  // automated submission. Report success without ever saving a Lead or
  // emailing Chris, so the bot has no signal to adapt to.
  if (parsed.data.website) {
    return { status: "success" };
  }

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(`lead-form:${ip}`, RATE_LIMIT)) {
    return {
      status: "error",
      message:
        "You've submitted a few requests recently — please wait a few minutes and try again, or call us directly.",
    };
  }

  try {
    const catalog = await getPublishedApplianceTypes();
    if (catalog.length > 0 && parsed.data.applianceTypeIds.length === 0) {
      return { status: "error", message: "Select at least one appliance, then send your request." };
    }
    const publishedIds = new Set(catalog.map(type => type.id));
    if (parsed.data.applianceTypeIds.some(id => !publishedIds.has(id))) {
      return { status: "error", message: "The appliance options changed. Refresh this page and try again." };
    }
    await createLead(parsed.data);
    return { status: "success" };
  } catch (error) {
    console.error("[leads] Failed to save lead", error);
    return {
      status: "error",
      message:
        "Something went wrong saving your request. Please try again, or call us directly.",
    };
  }
}
