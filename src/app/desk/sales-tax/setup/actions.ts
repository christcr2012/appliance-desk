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
    const parseMap = (field: string) => {
      if (!form.has(field)) return undefined;
      const rawJson = v(form, field);
      if (rawJson.length > 6000) throw new Error("Filing mapping is too large.");
      const parsed: unknown = JSON.parse(rawJson || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Filing mapping must be a JSON object.");
      return parsed;
    };
    const tristate = (field: string): boolean | null | undefined => {
      if (!form.has(field)) return undefined;
      const value = v(form, field);
      if (value === "yes") return true;
      if (value === "no") return false;
      if (value === "unknown") return null;
      throw new Error("Invalid SUTS upload capability.");
    };
    const areaIds = form.getAll("jurisdictionId").filter((id): id is string => typeof id === "string");
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
      licenseExpiresOn: form.has("licenseExpiresOn") ? dt(v(form, "licenseExpiresOn")) : undefined,
      screenLabels: parseMap("screenLabels") as FilingAccountInput["screenLabels"],
      deductionLabels: parseMap("deductionLabels") as FilingAccountInput["deductionLabels"],
      excelUploadAvailable: tristate("excelUploadAvailable"),
      bulkXmlAvailable: tristate("bulkXmlAvailable"),
      setupCheckedOn: form.has("setupCheckedOn")
        ? form.get("confirmSetupToday") === "on" ? new Date() : dt(v(form, "setupCheckedOn"))
        : undefined,
      areaAssignments: form.has("jurisdictionIdsPresent") ? areaIds.map(id => ({
        jurisdictionId: id,
        mode: v(form, "assignment:" + id) as "SALES" | "USE" | "NONE",
        filingCode: v(form, "code:" + id) || null,
        filingOrder: integer(v(form, "order:" + id)),
        serviceFeeMilliPercent: integer(v(form, "fee:" + id)),
      })) : undefined,
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
      jurisdictionId: v(form, "jurisdictionId") === "__DEFAULT_STATE__"
        ? null : v(form, "jurisdictionId"),
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

