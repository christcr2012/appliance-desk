"use server";

import { headers } from "next/headers";
import { createLead } from "@/domains/leads";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";
import { getPublishedCatalog } from "@/domains/pricing";
import { isRateLimited } from "@/lib/rate-limit";

export type SubmitLeadState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

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

  if (parsed.data.website) {
    return { status: "success" };
  }

  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  if (await isRateLimited(`lead-form:${ip}`, RATE_LIMIT)) {
    return {
      status: "error",
      message:
        "You've submitted a few requests recently — please wait a few minutes and try again, or call us directly.",
    };
  }

  try {
    const catalog = await getPublishedCatalog();
    const packageIds = parsed.data.packageIds ?? [];
    if (catalog.length > 0 && parsed.data.applianceTypeIds.length + packageIds.length === 0) {
      return { status: "error", message: "Select at least one appliance, then send your request." };
    }
    const published = (kind: "type" | "package") => new Set(catalog.filter(item => item.kind === kind).map(item => item.id));
    const publishedTypes = published("type");
    const publishedPackages = published("package");
    if (parsed.data.applianceTypeIds.some(id => !publishedTypes.has(id)) || packageIds.some(id => !publishedPackages.has(id))) {
      return { status: "error", message: "The appliance options changed. Refresh this page and try again." };
    }
    await createLead({ ...parsed.data, packageIds });
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
