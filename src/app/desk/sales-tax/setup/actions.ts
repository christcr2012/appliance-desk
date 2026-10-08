"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { saveTaxSettings, saveTaxFilingAccount, saveTaxabilityCell, addRdfRate, addManualTaxRateVersion, type TaxSettingsInput, type FilingAccountInput } from "@/domains/tax/setup";
import { RdfHandling, ShortTermLeaseElection, TaxFilingAccountKind, TaxFilingFrequency, TaxReportingBasis, TaxChargeCategory, Taxability } from "@prisma/client";
export type TaxActionState = { error: string; success: string };
const v = (data: FormData, key: string) => {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
};
const dt = (value: string) => value ? new Date(value + (value.length === 10 ? "T12:00:00.000Z" : "")) : null;
const integer = (value: string) => value.trim() ? Number(value) : Number.NaN;
function err(error: unknown): TaxActionState {
  const message = error instanceof Error ? error.message : "";
  if (/not authorized|not allowed|role|permission/i.test(message)) return { error: "Owner access is required.", success: "" };
  if (/invalid|enter|changed|refresh|missing|must|cannot|duplicate|already exists/i.test(message))
    return { error: message.slice(0, 500), success: "" };
  return { error: "Couldn't save this change. Check your entries and refresh.", success: "" };
}
export async function saveTaxSettingsAction(_state: TaxActionState, form: FormData): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    const loc = ["line1", "city", "state", "zip"].map(key => v(form, key));
    const input: TaxSettingsInput = {
      shortTermLeaseElection: v(form, "shortTermLeaseElection") as ShortTermLeaseElection,
      shortTermLeaseElectionNote: v(form, "shortTermLeaseElectionNote") || null,
      rdfHandling: v(form, "rdfHandling") as RdfHandling,
      rdfThresholdCents: integer(v(form, "rdfThresholdCents")),
      rdfCpaConfirmedOn: dt(v(form, "rdfCpaConfirmedOn")),
      autoApplyOfficialRateChanges: form.get("autoApplyOfficialRateChanges") === "on",
      autoRateChangeMaxMilliPercent: integer(v(form, "autoRateChangeMaxMilliPercent")),
      businessLocation: loc.some(Boolean) ? {
        line1: loc[0]!, city: loc[1]!, state: loc[2]!, zip: loc[3]!,
      } : null,
    };
    await saveTaxSettings(session.user.id, input, new Date(v(form, "expectedUpdatedAt")));
    revalidatePath("/desk/sales-tax/setup");
    return { error: "", success: "Settings saved. Check the current billing-readiness status." };
  } catch (error) { return err(error); }
}
export async function saveTaxAccountAction(_state: TaxActionState, form: FormData): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    const raw = v(form, "reminderDaysBefore");
    const input: FilingAccountInput = {
      id: v(form, "id") || null,
      name: v(form, "name"),
      kind: v(form, "kind") as TaxFilingAccountKind,
      frequency: v(form, "frequency") as TaxFilingFrequency,
      basis: v(form, "basis") as TaxReportingBasis,
      accountNumber: v(form, "accountNumber") || null,
      portalUrl: v(form, "portalUrl") || null,
      dueDayOfFollowingMonth: integer(v(form, "dueDayOfFollowingMonth")),
      firstPeriodStart: dt(v(form, "firstPeriodStart")),
      reminderDaysBefore: raw ? raw.split(",").map(s => Number(s.trim())) : [],
      emailReminders: form.get("emailReminders") === "on",
      active: form.get("active") === "on",
      filingNotes: v(form, "filingNotes") || null,
    };
    const saved = await saveTaxFilingAccount(session.user.id, input, dt(v(form, "expectedUpdatedAt")));
    revalidatePath("/desk/sales-tax/setup");
    revalidatePath("/desk/sales-tax/setup/accounts/" + saved.id);
    return { error: "", success: "Filing account saved. Review any missing account answers." };
  } catch (error) { return err(error); }
}
export async function saveTaxCellAction(_state: TaxActionState, form: FormData): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    await saveTaxabilityCell(session.user.id, {
      jurisdictionId: v(form, "jurisdictionId"),
      category: v(form, "category") as TaxChargeCategory,
      taxability: v(form, "taxability") as Taxability,
      cpaConfirmedOn: dt(v(form, "cpaConfirmedOn")) ?? new Date("invalid"),
      reason: v(form, "reason"),
    });
    revalidatePath("/desk/sales-tax/taxability");
    return { error: "", success: "Taxability decision saved with an audit entry." };
  } catch (error) { return err(error); }
}
export async function addRdfRateAction(_state: TaxActionState, form: FormData): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    await addRdfRate(session.user.id, {
      effectiveOn: dt(v(form, "effectiveOn")) ?? new Date("invalid"),
      amountCents: integer(v(form, "amountCents")),
    });
    revalidatePath("/desk/sales-tax/setup");
    return { error: "", success: "New July fee rate saved without rewriting historical rates." };
  } catch (error) { return err(error); }
}


export async function addManualRateAction(
  _state: TaxActionState, form: FormData,
): Promise<TaxActionState> {
  try {
    const session = await requireRole("OWNER");
    await addManualTaxRateVersion(session.user.id, {
      jurisdictionId: v(form, "jurisdictionId"),
      effectiveFrom: dt(v(form, "effectiveFrom")) ?? new Date("invalid"),
      rateMilliPercent: integer(v(form, "rateMilliPercent")),
      sourceNote: v(form, "sourceNote"),
    });
    revalidatePath("/desk/sales-tax/taxability");
    return { error: "", success: "A new rate version was recorded; past rates remain unchanged." };
  } catch (error) { return err(error); }
}

