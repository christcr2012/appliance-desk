"use server";

// AR-8 (SETTINGS spec section 5): the generic row save for plain
// BusinessSettings scalars, plus the domain-writer rows and the undo the
// saved toast offers. Every save carries the revision the page was opened
// with — a stale page is refused as a conflict, never silently overwritten.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { settingRowByKey, type SettingRowDef } from "@/domains/settings/catalog";
import { updateBusinessSettings } from "@/domains/settings";
import { SettingsConflictError } from "@/domains/settings/effects";
import { SettingsValidationError } from "@/domains/settings/cross-fields";
import { SettingsUndoError, listSettingsHistory, previewSettingsUndo, undoSettingsChange } from "@/domains/settings/history";
import { dollarsToCents } from "@/domains/pricing";

export type RowSaveState =
  | { status: "success"; auditId?: string }
  | { status: "error"; message: string };

const GENERIC: RowSaveState = {
  status: "error",
  message: "Settings could not be saved. Your change is still here; please try again.",
};

function validateAndConvert(def: SettingRowDef, value: unknown): { ok: true; stored: unknown } | { ok: false; message: string } {
  const fail = (message: string) => ({ ok: false as const, message });
  switch (def.kind) {
    case "money": {
      const parsed = z.number().finite().min(0).max(def.max ?? 1_000_000).safeParse(value);
      if (!parsed.success) return fail("Enter an amount of $0 or more.");
      const cents = dollarsToCents(parsed.data);
      if (Math.abs(parsed.data * 100 - cents) > 0.001) return fail("Enter an amount with at most two decimal places.");
      return { ok: true, stored: cents };
    }
    case "days":
    case "hours":
    case "minutes":
    case "number": {
      let schema = z.number().finite();
      if (def.kind !== "number") schema = schema.int();
      if (def.min !== undefined) schema = schema.min(def.min);
      if (def.max !== undefined) schema = schema.max(def.max);
      const parsed = schema.safeParse(value);
      if (!parsed.success) return fail(`Enter a whole number${def.min !== undefined && def.max !== undefined ? ` between ${def.min} and ${def.max}` : ""}.`);
      return { ok: true, stored: parsed.data };
    }
    case "percent": {
      const parsed = z.number().finite().min(def.min ?? 0).max(def.max ?? 100).safeParse(value);
      if (!parsed.success) return fail(`Enter a percent between ${def.min ?? 0} and ${def.max ?? 100}.`);
      return { ok: true, stored: parsed.data };
    }
    case "yesno": {
      const parsed = z.boolean().safeParse(value);
      if (!parsed.success) return fail("That switch needs an on or off answer.");
      return { ok: true, stored: parsed.data };
    }
    case "text": {
      const parsed = z.string().trim().max(def.max ?? 200).safeParse(value);
      if (!parsed.success) return fail(`Keep it under ${def.max ?? 200} characters.`);
      return { ok: true, stored: parsed.data };
    }
    case "list": {
      const parsed = z.array(z.string().trim().min(1)).max(100).safeParse(value);
      if (!parsed.success) return fail("That list could not be read.");
      return { ok: true, stored: parsed.data };
    }
    case "choice": {
      // Multi-choice (exportPayoutLines): an object of on/off over the def's choices.
      if (!value || typeof value !== "object" || Array.isArray(value)) return fail("That choice could not be read.");
      const allowed = new Set((def.choices ?? []).map((c) => c.value));
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!allowed.has(k) || typeof v !== "boolean") return fail("That choice could not be read.");
        out[k] = v;
      }
      return { ok: true, stored: out };
    }
    default:
      return fail("That setting is changed on its own screen.");
  }
}

export async function saveSettingRowAction(
  key: string,
  value: unknown,
  revision: string,
): Promise<RowSaveState> {
  const session = await requireRole("OWNER", "ADMIN");
  const def = settingRowByKey(key);
  if (!def) return { status: "error", message: "That setting was not found." };
  if (def.who === "owner" && session.user.role !== "OWNER") {
    return { status: "error", message: "Only the owner can change this." };
  }

  // Domain-writer rows: the writer locks and audits itself.
  if (typeof def.editor === "object" && "domainWriter" in def.editor) {
    try {
      if (def.editor.domainWriter === "setRetiredFollowUpDays") {
        const parsed = z.number().int().min(def.min ?? 1).max(def.max ?? 365).safeParse(value);
        if (!parsed.success) return { status: "error", message: "Enter a whole number of days." };
        const { setRetiredFollowUpDays } = await import("@/domains/inventory/retired-plans");
        await setRetiredFollowUpDays(session.user.id, parsed.data);
      } else if (def.editor.domainWriter === "setApprovalExpiryDays") {
        const parsed = z.number().int().min(1).max(30).safeParse(value);
        if (!parsed.success) return { status: "error", message: "Requests can wait between 1 and 30 days." };
        const { setApprovalExpiryDays } = await import("@/domains/approvals");
        await setApprovalExpiryDays(session.user.id, parsed.data);
      } else if (def.editor.domainWriter === "updateTrustedDeviceSettings") {
        const { updateTrustedDeviceSettings } = await import("@/domains/security/trusted-devices");
        await updateTrustedDeviceSettings(session.user.id, { days: value });
      } else {
        return GENERIC;
      }
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : GENERIC.message };
    }
    revalidatePath("/desk/settings");
    return { status: "success" };
  }

  if (def.editor !== "row") return { status: "error", message: "That setting is changed on its own screen." };

  const converted = validateAndConvert(def, value);
  if (!converted.ok) return { status: "error", message: converted.message };

  try {
    const { auditId } = await updateBusinessSettings(
      session.user.id,
      { [key]: converted.stored } as never,
      { expectedRevision: { keys: [key], value: revision } },
    );
    revalidatePath("/desk/settings");
    return { status: "success", auditId };
  } catch (error) {
    if (error instanceof SettingsConflictError) return { status: "error", message: error.message };
    if (error instanceof SettingsValidationError) return { status: "error", message: error.message };
    return GENERIC;
  }
}

/** The Undo on the "Saved {label}" toast: undoes that one change through the existing history undo. */
export async function undoSettingRowAction(auditId: string, key: string): Promise<RowSaveState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await undoSettingsChange(session.user.id, auditId, key);
  } catch (error) {
    if (error instanceof SettingsUndoError || error instanceof SettingsConflictError) {
      return { status: "error", message: error.message };
    }
    return GENERIC;
  }
  revalidatePath("/desk/settings");
  return { status: "success" };
}

export type RowHistoryEntry = {
  auditId: string;
  at: string;
  by: string;
  from: string;
  to: string;
  undoable: boolean;
  undoReason?: string;
};

/** One setting's changes for the row's History sheet (SETTINGS spec section 5): newest first, at most 20. */
export async function rowHistoryAction(key: string): Promise<RowHistoryEntry[]> {
  await requireRole("OWNER", "ADMIN");
  const history = await listSettingsHistory(50);
  const out: RowHistoryEntry[] = [];
  for (const row of history) {
    const change = row.changes.find((c) => c.key === key);
    if (!change) continue;
    const undo = row.undo.find((u) => u.key === key);
    let undoable = Boolean(undo?.ok);
    let undoReason = undo?.reason;
    if (undoable) {
      const preview = await previewSettingsUndo(row.id, key);
      if (!preview.ok) {
        undoable = false;
        undoReason = preview.reason;
      }
    }
    out.push({
      auditId: row.id,
      at: row.at.toISOString(),
      by: row.by,
      from: change.from,
      to: change.to,
      undoable,
      undoReason,
    });
    if (out.length >= 20) break;
  }
  return out;
}
