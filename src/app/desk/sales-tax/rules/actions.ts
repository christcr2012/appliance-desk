"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { businessDateFromKey } from "@/lib/business-date";
import { buildRuleValueFromFields, saveRuleVersion, saveRuleTimingSettings, saveWatchOfficialPagesSetting, undoRuleVersion } from "@/domains/rules/changes";
import { ruleAsOf } from "@/domains/rules/reads";
import { isRuleKey, ruleDef } from "@/domains/rules/registry";

export type RuleActionResult = {
  status: "ok" | "error";
  message: string;
  /** The kit's form runner reads `error`/`success`; the change form reads `status`/`message`. */
  error?: string;
  success?: string;
};

function okResult(message: string): RuleActionResult {
  return { status: "ok", message, success: message };
}

function errorResult(error: unknown): RuleActionResult {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return { status: "error", message, error: message };
}

const RULES_PATH = "/desk/sales-tax/rules";

/** OWNER-only: record a new dated value for a rule, with a reason. A start date in the past is the late-change path: bills already sent never change. */
export async function saveRuleChangeAction(key: string, form: FormData): Promise<RuleActionResult> {
  try {
    const session = await requireRole("OWNER");
    if (!isRuleKey(key)) throw new Error("Unknown tax rule.");
    const def = ruleDef(key);
    const rawDate = form.get("effectiveFrom");
    if (typeof rawDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw new Error("Enter the date the new value starts.");
    }
    const effectiveFrom = businessDateFromKey(rawDate);
    if (!effectiveFrom) throw new Error("Enter a valid start date.");
    const reason = typeof form.get("reason") === "string" ? (form.get("reason") as string).trim() : "";
    if (!reason) throw new Error("Say why this rule is changing.");
    if (reason.length > 500) throw new Error("The reason must be 500 characters or fewer.");
    const fields: Record<string, string | undefined> = {};
    for (const field of def.fields) {
      const value = form.get(field.name);
      fields[field.name] = typeof value === "string" ? value : undefined;
    }
    const current = await ruleAsOf(key, new Date()).catch(() => null);
    const value = buildRuleValueFromFields(def, fields, current?.value ?? null);
    await saveRuleVersion(session.user.id, { key, value, effectiveFrom, reason });
    revalidatePath(RULES_PATH);
    return okResult("Rule changed.");
  } catch (error) {
    return errorResult(error);
  }
}

/** OWNER-only: undo an owner change whose start date has not arrived yet. */
export async function undoRuleVersionAction(versionId: string): Promise<RuleActionResult> {
  try {
    const session = await requireRole("OWNER");
    await undoRuleVersion(session.user.id, versionId);
    revalidatePath(RULES_PATH);
    return okResult("Change undone.");
  } catch (error) {
    return errorResult(error);
  }
}

/** Form adapter for the Rules table's ⋯ menu, which posts the version id. */
export async function undoRuleVersionFormAction(form: FormData): Promise<RuleActionResult> {
  const versionId = form.get("versionId");
  if (typeof versionId !== "string" || !versionId) {
    return errorResult(new Error("That rule change was not found."));
  }
  return undoRuleVersionAction(versionId);
}

/** The watch form's useActionState shape. */
export async function saveWatchSettingsFormAction(
  _state: { error: string; success: string },
  form: FormData,
): Promise<{ error: string; success: string }> {
  const result = await saveWatchSettingsAction(form);
  return {
    error: result.status === "error" ? result.message : "",
    success: result.status === "ok" ? result.message : "",
  };
}

/** OWNER-only: the master switch for the official-page watches (TFA-3). */
export async function saveWatchSettingsAction(form: FormData): Promise<RuleActionResult> {
  try {
    const session = await requireRole("OWNER");
    const enabled = form.get("watchOfficialTaxPages") === "on";
    const expectedEnabled = form.get("expectedEnabled") === "on";
    await saveWatchOfficialPagesSetting(session.user.id, { enabled, expectedEnabled });
    revalidatePath(RULES_PATH);
    return okResult(enabled ? "Watching is on." : "Watching is off. Nothing will be read until you turn it back on.");
  } catch (error) {
    return errorResult(error);
  }
}

/** The timing form's useActionState shape. */
export async function saveTimingSettingsFormAction(
  _state: { error: string; success: string },
  form: FormData,
): Promise<{ error: string; success: string }> {
  const result = await saveTimingSettingsAction(form);
  return {
    error: result.status === "error" ? result.message : "",
    success: result.status === "ok" ? result.message : "",
  };
}

/** OWNER-only: the timing setting for changes that cost the business. */
export async function saveTimingSettingsAction(form: FormData): Promise<RuleActionResult> {
  try {
    const session = await requireRole("OWNER");
    const restore = form.get("operation") === "restore";
    const percent = restore ? 90 : Number(form.get("percent"));
    const marginBusinessDays = restore ? 3 : Number(form.get("marginBusinessDays"));
    const expectedPercent = Number(form.get("expectedPercent"));
    const expectedMarginBusinessDays = Number(form.get("expectedMarginBusinessDays"));
    await saveRuleTimingSettings(session.user.id, { percent, marginBusinessDays, expectedPercent, expectedMarginBusinessDays });
    revalidatePath(RULES_PATH);
    return okResult(restore ? "Timing restored to 90% and 3 business days." : "Timing saved.");
  } catch (error) {
    return errorResult(error);
  }
}
