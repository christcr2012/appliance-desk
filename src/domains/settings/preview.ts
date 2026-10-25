import { createHash } from "node:crypto";
import { describeSettingsChange, UNDOABLE_SETTINGS, type SettingsChange } from "./history";
import { settingEffect } from "./effects";
export { SettingsConflictError, SETTINGS_CONFLICT_MESSAGE, settingEffect } from "./effects";
import type { EditableSettingsSection } from "./section-config";

/**
 * Settings change preview and stale-save check (Batch O, O-1 / design D-O1 and the 2026-10-08 ENH-O addition).
 *
 * Everything here is pure: a preview never writes data, calls a provider, changes a price or reserves an approval.
 * The "revision" of a settings section is a short fingerprint of ONLY the stored values that section saves. If another
 * person changed one of those values after the page was opened, the fingerprint differs and the save is refused with a
 * plain message instead of overwriting their decision. Changes to unrelated settings (and background bookkeeping on the
 * same row) never cause a false conflict.
 */

/** The stored columns each editable settings section writes. A test keeps this in step with `settingsSectionUpdate`. */
export const SECTION_STORED_KEYS: Record<EditableSettingsSection, readonly string[]> = {
  profile: [
    "publicBusinessName", "publicPhone", "publicEmail", "publicAddress",
    "hours", "holidayClosures", "socialLinks", "logoUrl",
  ],
  "service-area": ["serviceAreaCities", "serviceAreaZips"],
  policies: [
    "oneTimeDeliveryFeeCents", "oneTimeInstallationFeeCents", "oneTimeRemovalFeeCents",
    "damageWaiverEnabled", "depositEnabled", "lateFeeGraceDays", "lateFeeFlatCents", "lateFeePercent",
    "sixMonthPrepayDiscountSetCents", "sixMonthPrepayDiscountSingleCents",
    "twelveMonthPrepayDiscountSetCents", "twelveMonthPrepayDiscountSingleCents",
    "twelveMonthPrepayFreeMonthEnabled", "referralRewardCents", "draftReservationHoldDays", "receiptFileKeepDays", "unsentPhotoKeepDays",
  ],
};

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/** Fingerprint of just these stored fields. Pass the current settings row (or null when none exists yet). */
export function fieldsRevision(row: unknown, keys: readonly string[]): string {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const body = [...keys].sort().map((k) => `${k}=${stable(r[k])}`).join("|");
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

export function sectionRevision(row: unknown, section: EditableSettingsSection): string {
  return fieldsRevision(row, SECTION_STORED_KEYS[section]);
}

export type SettingsPreviewLine = SettingsChange & { effect: string };
export type SettingsPreview = { lines: SettingsPreviewLine[]; nothingToSave: boolean };

/**
 * What saving `update` would change, comparing against the current stored row. Only fields present in `update` are
 * compared, so an unrelated column can never appear. Pure: reads nothing, writes nothing.
 */
export function previewSettingsUpdate(current: unknown, update: Record<string, unknown>): SettingsPreview {
  const before = (current && typeof current === "object" ? current : {}) as Record<string, unknown>;
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(update)) after[key] = update[key];
  const scoped: Record<string, unknown> = {};
  for (const key of Object.keys(update)) scoped[key] = before[key];
  const lines = describeSettingsChange(scoped, after).map((c) => ({ ...c, effect: settingEffect(c.key) }));
  return { lines, nothingToSave: lines.length === 0 };
}

/** True when this key can be undone from the history screen (kept here so screens need one import). */
export function isUndoableSetting(key: string): boolean {
  return Object.hasOwn(UNDOABLE_SETTINGS, key);
}
