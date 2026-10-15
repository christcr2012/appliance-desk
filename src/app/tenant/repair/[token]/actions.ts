"use server";
import { submitTenantRepair } from "@/domains/customers/location-contacts";
export async function submitTenantRepairAction(token: string, input: { applianceId: string; problem: string }) {
  try { await submitTenantRepair(token, input); return { ok: true as const }; }
  catch (error) { return { ok: false as const,
    message: error instanceof Error ? error.message : "Unable to submit this report." }; }
}
