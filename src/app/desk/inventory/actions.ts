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
import {
  startRepairForAppliance,
  retireAppliance,
  getSwapCandidates,
  startSwapForAppliance,
  recordApplianceInspection,
} from "@/domains/inventory/guided-actions";
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

// ---------------------------------------------------------------------------
// Guided actions — repair, retire, swap, inspection. See
// src/domains/inventory/guided-actions.ts for the underlying rules; each of
// these actions is just role-check + validation + a plain-language error
// message, following the same shape as the actions above.
// ---------------------------------------------------------------------------

const startRepairSchema = z.object({
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/** "Start a repair" on an appliance's own page — moves it to Maintenance
 * and creates the maintenance-visit job in one step, instead of Chris
 * having to change the status and separately remember to schedule a job. */
export async function startRepairAction(
  applianceId: string,
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = startRepairSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    await startRepairForAppliance(session.user.id, applianceId, parsed.data.notes || undefined);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't start a repair for that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  revalidatePath("/desk/jobs");

  return { status: "success" };
}

const retireSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to retire an appliance."),
});

export async function retireApplianceAction(
  applianceId: string,
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = retireSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "A reason is required to retire an appliance.",
    };
  }

  try {
    await retireAppliance(session.user.id, applianceId, parsed.data.reason);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't retire that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

export type SwapCandidate = {
  id: string;
  assetNumber: string;
  manufacturer: string | null;
  model: string | null;
  applianceTypeName: string;
};

/** The list of other available units of the same appliance type, for the
 * "Swap for a working unit" picker on the appliance page. */
export async function getSwapCandidatesAction(applianceId: string): Promise<SwapCandidate[]> {
  await requireRole("OWNER", "ADMIN");

  const candidates = await getSwapCandidates(applianceId);

  return candidates.map((c) => ({
    id: c.id,
    assetNumber: c.assetNumber,
    manufacturer: c.manufacturer,
    model: c.model,
    applianceTypeName: c.applianceType.name,
  }));
}

export async function startSwapAction(
  applianceId: string,
  replacementApplianceId: string,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!replacementApplianceId) {
    return { status: "error", message: "Choose a replacement unit." };
  }

  try {
    await startSwapForAppliance(session.user.id, applianceId, replacementApplianceId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't swap that appliance.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath(`/desk/inventory/${replacementApplianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  revalidatePath("/desk/jobs");

  return { status: "success" };
}

const inspectionSchema = z.object({
  passed: z.boolean(),
  checklist: z.array(z.object({ item: z.string(), checked: z.boolean() })),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  condition: z.string().trim().max(200).optional().or(z.literal("")),
});

/** Recording a returned appliance's inspection — passing moves it back to
 * Available, failing moves it to Maintenance. See
 * src/domains/inventory/guided-actions.ts's recordApplianceInspection. */
export async function recordInspectionAction(
  applianceId: string,
  raw: Record<string, unknown>,
): Promise<InventoryActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = inspectionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    await recordApplianceInspection(session.user.id, applianceId, {
      passed: parsed.data.passed,
      checklist: parsed.data.checklist,
      notes: parsed.data.notes || undefined,
      condition: parsed.data.condition || undefined,
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't record that inspection.",
    };
  }

  revalidatePath("/desk/inventory");
  revalidatePath(`/desk/inventory/${applianceId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");

  return { status: "success" };
}
