import { prisma } from "@/lib/prisma";
import { assertCapability } from "@/domains/capabilities";
import type { Prisma } from "@prisma/client";
import { SettingsConflictError, settingEffect } from "./effects";

/**
 * Settings history (Batch O, O-1 / design D-O1).
 *
 * Every "settings.update" audit row stores the whole settings row before and after. This module turns a row into a
 * plain-words list of what changed, and lets the owner undo ONE change, but only when it is safe:
 *  - the field must be one of the plain everyday settings listed below (never agreement terms, tax approvals, the
 *    customer-email switch, security or signing policy: those have their own screens and rules);
 *  - the field must still hold the value that change left it with (if it changed again, undo is hidden and says why).
 * Undo only ever writes the BusinessSettings row (stop rule S-O3) and writes its own "Undo of …" audit row.
 */

type Kind = "money" | "text" | "yesno" | "number" | "list" | "days" | "choice";
type Spec = { label: string; kind: Kind };

/** The everyday settings that can be undone from the history screen. */
export const UNDOABLE_SETTINGS: Record<string, Spec> = {
  publicBusinessName: { label: "Business name", kind: "text" },
  publicPhone: { label: "Public phone", kind: "text" },
  publicEmail: { label: "Public email", kind: "text" },
  publicAddress: { label: "Public address", kind: "text" },
  serviceAreaCities: { label: "Service area cities", kind: "list" },
  serviceAreaZips: { label: "Service area ZIP codes", kind: "list" },
  oneTimeDeliveryFeeCents: { label: "Delivery fee", kind: "money" },
  oneTimeInstallationFeeCents: { label: "Installation fee", kind: "money" },
  oneTimeRemovalFeeCents: { label: "Removal fee", kind: "money" },
  damageWaiverEnabled: { label: "Damage waiver", kind: "yesno" },
  depositEnabled: { label: "Deposits", kind: "yesno" },
  lateFeeGraceDays: { label: "Late fee grace days", kind: "days" },
  lateFeeFlatCents: { label: "Flat late fee", kind: "money" },
  lateFeePercent: { label: "Late fee percent", kind: "number" },
  sixMonthPrepayDiscountSetCents: { label: "6-month prepay discount (washer and dryer set)", kind: "money" },
  sixMonthPrepayDiscountSingleCents: { label: "6-month prepay discount (single appliance)", kind: "money" },
  twelveMonthPrepayDiscountSetCents: { label: "12-month prepay discount (washer and dryer set)", kind: "money" },
  twelveMonthPrepayDiscountSingleCents: { label: "12-month prepay discount (single appliance)", kind: "money" },
  twelveMonthPrepayFreeMonthEnabled: { label: "Free month with 12-month prepay", kind: "yesno" },
  referralRewardCents: { label: "Referral reward", kind: "money" },
  draftReservationHoldDays: { label: "Days to hold a draft reservation", kind: "days" },
  defaultJobDurationMinutes: { label: "Default visit length (minutes)", kind: "number" },
  staffMayWorkUnassignedJobs: { label: "Staff may take unassigned visits", kind: "yesno" },
  pickupDayNotBilled: { label: "Pickup day not billed", kind: "yesno" },
  outOfServiceEscalationDays: { label: "Days before an out-of-service appliance is flagged", kind: "days" },
};

/** Fields we show but never undo here (they have their own screens, approvals or locked history). */
const NOT_SHOWN = new Set(["id", "updatedAt", "createdAt"]);

function words(key: string): string {
  const spaced = key.replace(/Cents$/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatSettingValue(kind: Kind | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "not set";
  if (kind === "money" && typeof value === "number") return `$${(value / 100).toFixed(2)}`;
  if (kind === "yesno" || typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) {
    if (value.some((v) => v !== null && typeof v === "object")) return value.length ? "changed (see the settings screen)" : "none";
    return value.length ? value.map(String).join(", ") : "none";
  }
  if (typeof value === "object") return "changed (see the settings screen)";
  return String(value);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type SettingsChange = {
  key: string;
  label: string;
  from: string;
  to: string;
  undoable: boolean;
};

/** What changed between the stored "before" and "after" copies of the settings row. Pure. */
export function describeSettingsChange(before: unknown, after: unknown): SettingsChange[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !NOT_SHOWN.has(k));
  const out: SettingsChange[] = [];
  for (const key of keys.sort()) {
    if (same(b[key], a[key])) continue;
    const spec = UNDOABLE_SETTINGS[key];
    out.push({
      key,
      label: spec?.label ?? words(key),
      from: formatSettingValue(spec?.kind, b[key]),
      to: formatSettingValue(spec?.kind, a[key]),
      undoable: Boolean(spec),
    });
  }
  return out;
}

export type SettingsHistoryRow = {
  id: string;
  at: Date;
  by: string;
  isUndo: boolean;
  changes: SettingsChange[];
  /** Per change: can it be undone right now, or why not. */
  undo: { key: string; ok: boolean; reason?: string }[];
};

export async function listSettingsHistory(limit = 50): Promise<SettingsHistoryRow[]> {
  const [rows, current] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: { in: ["settings.update", "settings.undo"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.businessSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  const now = (current ?? {}) as Record<string, unknown>;
  const out: SettingsHistoryRow[] = [];
  // Newest first: a field is "changed again" if a newer row touched it.
  const touchedLater = new Set<string>();
  for (const r of rows) {
    const changes = describeSettingsChange(r.oldValue, r.newValue);
    const after = (r.newValue ?? {}) as Record<string, unknown>;
    out.push({
      id: r.id,
      at: r.createdAt,
      by: r.user?.name || r.user?.email || "Someone",
      isUndo: r.action === "settings.undo",
      changes,
      undo: changes
        .filter((c) => c.undoable)
        .map((c) => {
          if (r.action === "settings.undo") return { key: c.key, ok: false, reason: "This was already an undo." };
          if (touchedLater.has(c.key) || !same(now[c.key], after[c.key]))
            return { key: c.key, ok: false, reason: "Changed again since, so undoing it here could undo a newer decision." };
          return { key: c.key, ok: true };
        }),
    });
    for (const c of changes) touchedLater.add(c.key);
  }
  return out;
}

export class SettingsUndoError extends Error {}

/** The reasons an undo can be refused or conflict, in the words shown to the owner. */
const MSG = {
  notUndoable: "That setting cannot be undone from here.",
  gone: "That change is no longer in the history.",
  untouched: "That change did not touch this setting.",
  noSettings: "Settings were not found.",
  again: "This setting changed again after that change, so it was left alone.",
} as const;

type DbClient = Pick<typeof prisma, "auditLog" | "businessSettings">;

type UndoCheck =
  | { ok: false; reason: string }
  | { ok: true; before: Record<string, unknown>; after: Record<string, unknown>; now: Record<string, unknown>; rowId: string };

/** Every rule for "may this one change be undone right now". Reads only, so the preview and the real undo cannot disagree. */
async function checkUndo(db: DbClient, auditId: string, key: string): Promise<UndoCheck> {
  if (!Object.hasOwn(UNDOABLE_SETTINGS, key)) return { ok: false, reason: MSG.notUndoable };
  const row = await db.auditLog.findUnique({ where: { id: auditId } });
  if (!row || row.action !== "settings.update") return { ok: false, reason: MSG.gone };
  const before = (row.oldValue ?? {}) as Record<string, unknown>;
  const after = (row.newValue ?? {}) as Record<string, unknown>;
  if (same(before[key], after[key])) return { ok: false, reason: MSG.untouched };
  const current = await db.businessSettings.findUnique({ where: { id: "singleton" } });
  if (!current) return { ok: false, reason: MSG.noSettings };
  const now = current as unknown as Record<string, unknown>;
  if (!same(now[key], after[key])) return { ok: false, reason: MSG.again };
  // A newer change that put the same value back still counts as "changed again": it was a newer decision.
  const newer = await db.auditLog.findMany({
    where: { action: { in: ["settings.update", "settings.undo"] }, createdAt: { gt: row.createdAt }, id: { not: row.id } },
    select: { oldValue: true, newValue: true },
  });
  if (newer.some((n) => !same(((n.oldValue ?? {}) as Record<string, unknown>)[key], ((n.newValue ?? {}) as Record<string, unknown>)[key])))
    return { ok: false, reason: MSG.again };
  return { ok: true, before, after, now, rowId: row.id };
}

export type SettingsUndoPreview =
  | { ok: false; reason: string }
  | {
      ok: true;
      key: string;
      label: string;
      /** What the setting holds now. */
      current: string;
      /** What it will hold after the undo. */
      restored: string;
      effect: string;
      /** Hand this back when confirming: the undo is refused if the setting no longer holds it. */
      expectedCurrent: string;
    };

/** Shows what an undo would do. Writes nothing. */
export async function previewSettingsUndo(auditId: string, key: string): Promise<SettingsUndoPreview> {
  const checked = await checkUndo(prisma, auditId, key);
  if (!checked.ok) return checked;
  const spec = UNDOABLE_SETTINGS[key];
  return {
    ok: true,
    key,
    label: spec.label,
    current: formatSettingValue(spec.kind, checked.now[key]),
    restored: formatSettingValue(spec.kind, checked.before[key]),
    effect: settingEffect(key),
    expectedCurrent: JSON.stringify(checked.now[key] ?? null),
  };
}

/**
 * Undo one change, one field, from one history row. Refuses when the field changed again or is not undoable.
 * `expectedCurrent` is the value the owner saw in the preview; if the setting holds something else when they confirm,
 * somebody saved in between and the undo is refused as a conflict instead of acting on a screen that is out of date.
 */
export async function undoSettingsChange(userId: string, auditId: string, key: string, expectedCurrent?: string) {
  if (!Object.hasOwn(UNDOABLE_SETTINGS, key)) throw new SettingsUndoError(MSG.notUndoable);
  return prisma.$transaction(async (tx) => {
    await assertCapability(tx, userId, "EDIT_SETTINGS");
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    // First: is the screen the owner confirmed from still true? If the setting moved after the preview, say so as a
    // conflict ("look again") rather than as a generic refusal.
    if (expectedCurrent !== undefined) {
      const now = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
      const held = (now as unknown as Record<string, unknown> | null)?.[key];
      if (expectedCurrent !== JSON.stringify(held ?? null)) throw new SettingsConflictError();
    }
    const checked = await checkUndo(tx, auditId, key);
    if (!checked.ok) throw new SettingsUndoError(checked.reason);
    const restored = (checked.before[key] ?? null) as Prisma.InputJsonValue | null;
    const data = { [key]: restored } as Prisma.BusinessSettingsUpdateInput;
    const updated = await tx.businessSettings.update({ where: { id: "singleton" }, data });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.undo",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: { [key]: checked.now[key] ?? null } as Prisma.InputJsonObject,
        newValue: { [key]: (updated as unknown as Record<string, unknown>)[key] ?? null } as Prisma.InputJsonObject,
      },
    });
    return updated;
  });
}
