"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  addLocationPerson, importLocationCsv, locationWorkspace, moveOutLocationPerson,
  parseLocationCsv, saveAccountLocationPermission, saveLocationDetails,
  setLocationRetention, type LocationActor,
} from "@/domains/customers/location-contacts";

async function scopedActor(customerId: string): Promise<LocationActor> {
  const session = await requireRole("OWNER", "ADMIN", "CUSTOMER");
  const role = session.user.role;
  if (role === "OWNER" || role === "ADMIN") return { role, userId: session.user.id };
  const customer = await prisma.customer.findFirst({
    where: { userId: session.user.id, archivedAt: null }, select: { id: true },
  });
  // Never let browser-supplied customerId select a different customer's tenant list.
  if (!customer || customer.id !== customerId)
    throw new Error("This property does not belong to your account.");
  return { role: "CUSTOMER", customerId: customer.id, userId: session.user.id };
}
function refresh(customerId: string) {
  revalidatePath("/account/properties");
  revalidatePath("/account/maintenance");
  revalidatePath("/desk/customers/" + customerId + "/locations");
  revalidatePath("/desk/customers/" + customerId);
}
export type MutationState = { ok: true; message: string } | { ok: false; message: string };
async function outcome(work: () => Promise<unknown>, customerId: string, message = "Saved."): Promise<MutationState> {
  try { await work(); refresh(customerId); return { ok: true, message }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save." }; }
}
export async function getLocationAccount(customerId: string) {
  const actor = await scopedActor(customerId);
  return locationWorkspace(actor, customerId);
}
export async function updateLocationAccountAction(customerId: string, raw: unknown) {
  const actor = await scopedActor(customerId);
  return outcome(() => saveAccountLocationPermission(actor, customerId, raw), customerId);
}
export async function updateLocationSiteAction(customerId: string, addressId: string, raw: unknown) {
  const actor = await scopedActor(customerId);
  return outcome(() => saveLocationDetails(actor, customerId, addressId, raw), customerId);
}
export async function addLocationPersonAction(customerId: string, addressId: string, raw: unknown) {
  const actor = await scopedActor(customerId);
  return outcome(() => addLocationPerson(actor, customerId, addressId, raw), customerId, "Contact added.");
}
export async function endLocationPersonAction(customerId: string, addressId: string, personId: string, inspection: boolean) {
  const actor = await scopedActor(customerId);
  return outcome(() => moveOutLocationPerson(actor, customerId, addressId, personId, inspection), customerId,
    inspection ? "Moved out; turnover inspection added to To do." : "Moved out; billing unchanged.");
}
function digest(text: string) { return createHash("sha256").update(text).digest("hex"); }
export async function previewLocationImportAction(customerId: string, csv: string) {
  const actor = await scopedActor(customerId);
  if (actor.role === "CUSTOMER") return { ok: false as const, message: "Owner/admin import only." };
  try {
    const rows = parseLocationCsv(csv);
    return { ok: true as const, count: rows.length, digest: digest(csv),
      addresses: rows.map(row => ({ street: row.street, unit: row.unit, city: row.city, zip: row.zip })) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Invalid CSV." };
  }
}
export async function commitLocationImportAction(customerId: string, csv: string, previewDigest: string) {
  const actor = await scopedActor(customerId);
  if (actor.role === "CUSTOMER") return { ok: false as const, message: "Owner/admin import only." };
  if (!/^[0-9a-f]{64}$/.test(previewDigest) || digest(csv) !== previewDigest)
    return { ok: false as const, message: "Preview this exact file again before importing." };
  return outcome(() => importLocationCsv(actor, customerId, csv), customerId, "Imported properties and contacts.");
}
export async function updateTenantRetentionAction(months: number) {
  const session = await requireRole("OWNER");
  try {
    await setLocationRetention({ role: "OWNER", userId: session.user.id }, months);
    revalidatePath("/desk/settings");
    return { ok: true as const, message: "Retention updated." };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Unable to update." };
  }
}
