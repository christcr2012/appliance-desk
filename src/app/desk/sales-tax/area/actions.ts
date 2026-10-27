"use server";

import { revalidatePath } from "next/cache";

import {
  saveReadiness,
  type SaveReadinessInput,
} from "@/domains/tax/delivery-readiness";
import { requireRole } from "@/lib/session";
import type { TaxActionState } from "../setup/actions";

function fail(error: unknown): TaxActionState {
  const raw = error instanceof Error ? error.message : "";
  return {
    success: "",
    error: /failed|changed|already|only|missing|review|find|invalid|cannot|choose/i.test(raw)
      ? raw.slice(0, 250)
      : "This place's readiness couldn't be saved. Refresh and try again.",
  };
}

const get = (data: FormData, field: string): string => {
  const value = data.get(field);
  return typeof value === "string" ? value.trim() : "";
};

const LICENSE = [
  "NONE",
  "AFTER_FIRST_DELIVERY",
  "AFTER_SECOND_DELIVERY_IN_12_MONTHS",
  "ALWAYS",
  "UNKNOWN",
] as const;
const CHANNEL = ["SUTS", "CITY_PORTAL", "STATE_RETURN", "UNKNOWN"] as const;

function pick<T extends readonly string[]>(
  values: T,
  raw: string,
  label: string,
): T[number] {
  if ((values as readonly string[]).includes(raw)) return raw as T[number];
  throw new Error(`Choose a valid value for ${label}.`);
}

export async function saveReadinessAction(
  _state: TaxActionState,
  form: FormData,
): Promise<TaxActionState> {
  try {
    const user = await requireRole("OWNER");
    const jurisdictionId = get(form, "jurisdictionId");
    if (!jurisdictionId) throw new Error("Couldn't find that place.");
    const sourceUrlRaw = get(form, "sourceUrl");
    const input: SaveReadinessInput = {
      licenseRequired: pick(LICENSE, get(form, "licenseRequired"), "the license rule"),
      filesThrough: pick(CHANNEL, get(form, "filesThrough"), "how returns are filed"),
      licenseRecordId: get(form, "licenseRecordId") || null,
      sourceUrl: sourceUrlRaw ? sourceUrlRaw.slice(0, 500) : null,
      notes: get(form, "notes") || null,
      markReviewed: get(form, "markReviewed") === "yes",
    };
    await saveReadiness(user.user.id, jurisdictionId, input);
    revalidatePath("/desk/sales-tax/area");
    return { success: "This place's delivery readiness was saved.", error: "" };
  } catch (error) {
    return fail(error);
  }
}
