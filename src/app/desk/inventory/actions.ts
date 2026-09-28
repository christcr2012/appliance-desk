"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  createApplianceUnits,
  updateApplianceStatus,
  updateApplianceDetails,
  createPartRecord,
  deletePartRecord,
} from "@/domains/inventory";
import { dollarsToCents } from "@/domains/pricing";
import type { ApplianceStatus } from "@prisma/client";
import { ALL_APPLIANCE_STATUSES } from "@/domains/inventory/lifecycle";

export type InventoryActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const ALL_STATUSES = ALL_APPLIANCE_STATUSES;

/** Comma-separated free text -> a clean string array — same pattern as
 * splitList in src/app/desk/settings/actions.ts, used here for the
 * "features" tag list (e.g. "front-load, agitator"). */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const newApplianceUnitSchema = z.object({
  applianceTypeId: z.string().trim().min(1, "Choose an appliance type."),
  quantity: z.coerce.number().int().min(1).max(100),
  manufacturer: z.string().trim().max(200).optional().or(z.literal("")),
  model: z.string().trim().max(200).optional().or(z.literal("")),
  serialNumber: z.string().trim().max(200).optional().or(z.literal("")),
  color: z.string().trim().max(100).optional().or(z.literal("")),
  features: z.string().trim().max(1000).optional().or(z.literal("")),
  condition: z.string().trim().max(200).optional().or(z.literal("")),
  purchaseDate: z.string().trim().optional().or(z.literal("")),
  acquisitionCostDollars: z.coerce.number().min(0).max(1000000).optional(),
  currentLocation: z.string().trim().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function createApplianceUnitsAction(
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newApplianceUnitSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  const data = parsed.data;

  try {
    await createApplianceUnits(session.user.id, {
      applianceTypeId: data.applianceTypeId,
      quantity: data.quantity,
      manufacturer: data.manufacturer || null,
      model: data.model || null,
      serialNumber: data.serialNumber || null,
      color: data.color || null,
      features: data.features ? splitList(data.features) : [],
      condition: data.condition || null,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      acquisitionCostCents:
        data.acquisitionCostDollars !== undefined
          ? dollarsToCents(data.acquisitionCostDollars)
          : null,
      currentLocation: data.currentLocation || null,
      notes: data.notes || null,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't add that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath("/desk/dashboard");

  return { status: "success" };
}

export async function updateApplianceStatusAction(
  applianceId: string,
  status: string,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!ALL_STATUSES.includes(status as ApplianceStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }

  try {
    await updateApplianceStatus(
      session.user.id,
      applianceId,
      status as ApplianceStatus,
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

const detailsSchema = z.object({
  manufacturer: z.string().trim().max(200).optional().or(z.literal("")),
  model: z.string().trim().max(200).optional().or(z.literal("")),
  serialNumber: z.string().trim().max(200).optional().or(z.literal("")),
  color: z.string().trim().max(100).optional().or(z.literal("")),
  features: z.string().trim().max(1000).optional().or(z.literal("")),
  condition: z.string().trim().max(200).optional().or(z.literal("")),
  currentLocation: z.string().trim().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function updateApplianceDetailsAction(
  applianceId: string,
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  const data = parsed.data;

  await updateApplianceDetails(session.user.id, applianceId, {
    manufacturer: data.manufacturer || null,
    model: data.model || null,
    serialNumber: data.serialNumber || null,
    color: data.color || null,
    features: data.features ? splitList(data.features) : [],
    condition: data.condition || null,
    currentLocation: data.currentLocation || null,
    notes: data.notes || null,
  });

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/activity");

  return { status: "success" };
}

const newPartRecordSchema = z.object({
  modelNumber: z.string().trim().min(1, "Enter the model number.").max(200),
  manufacturer: z.string().trim().max(200).optional().or(z.literal("")),
  applianceTypeId: z.string().trim().optional().or(z.literal("")),
  partNumber: z.string().trim().min(1, "Enter the part number.").max(200),
  partName: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  // Comma-separated other model numbers this same part also fits, e.g. a
  // dryer part known to work across several similar models. Each one gets
  // its own PartRecord row (parts are looked up by model number — see
  // getPartRecordsForModel in src/domains/inventory), so it shows up
  // whichever of those models Chris looks at later.
  compatibleModelNumbers: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** Logs a part number against a model number — and, when Chris knows it
 * also fits other models, against each of those too — for reuse on any
 * future unit of any of those models. See docs/BUSINESS-RULES.md and
 * src/domains/inventory. */
export async function createPartRecordAction(
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newPartRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  const data = parsed.data;

  // De-dupe case-insensitively (e.g. "WFW5620HW0" typed again in the
  // compatible-models box) while keeping the first-typed casing.
  const seen = new Set<string>();
  const modelNumbers: string[] = [];
  for (const m of [data.modelNumber, ...splitList(data.compatibleModelNumbers ?? "")]) {
    const key = m.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      modelNumbers.push(m);
    }
  }

  for (const modelNumber of modelNumbers) {
    await createPartRecord(session.user.id, {
      modelNumber,
      manufacturer: data.manufacturer || null,
      applianceTypeId: data.applianceTypeId || null,
      partNumber: data.partNumber,
      partName: data.partName || null,
      notes: data.notes || null,
    });
  }

  revalidatePath("/desk/inventory");
  revalidatePath("/desk/parts");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

export async function deletePartRecordAction(
  partRecordId: string,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  await deletePartRecord(session.user.id, partRecordId);

  revalidatePath("/desk/inventory");
  revalidatePath("/desk/parts");
  revalidatePath("/desk/activity");

  return { status: "success" };
}
