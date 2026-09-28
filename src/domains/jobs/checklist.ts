import type { JobType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Job completion checklists (2026-09-28, dispatch board) — pure, zero-
// database-import, same spirit as src/domains/inventory/lifecycle.ts. A
// starting checklist per job type Chris can work through in the field
// before marking a job Completed; nothing here blocks completion, it's
// just a memory aid so a step doesn't get skipped.
// ---------------------------------------------------------------------------

export type ChecklistItem = { item: string; checked: boolean };

export const DEFAULT_JOB_CHECKLISTS: Record<JobType, string[]> = {
  DELIVERY: [
    "Appliance loaded and delivered",
    "Installed and leveled",
    "Tested a full cycle",
    "Customer walkthrough done",
  ],
  INSTALLATION: [
    "Appliance connected (water/power/gas as needed)",
    "Installed and leveled",
    "Tested a full cycle",
    "Customer walkthrough done",
  ],
  SWAP: [
    "Old unit removed",
    "New unit installed and leveled",
    "Tested a full cycle",
    "Customer walkthrough done",
  ],
  MAINTENANCE_VISIT: [
    "Diagnosed the issue",
    "Repair completed or parts ordered",
    "Tested a full cycle",
  ],
  REMOVAL: ["Appliance disconnected", "Loaded for transport", "Site left clean"],
};

/** A fresh, all-unchecked checklist for a job type — used the first time
 * a job's own page is opened, before Chris has saved any progress. */
export function defaultChecklistFor(type: JobType): ChecklistItem[] {
  return DEFAULT_JOB_CHECKLISTS[type].map((item) => ({ item, checked: false }));
}

/** Defensively narrows the JSONB column back to a checklist shape —
 * same pattern as featuresToText/parseServiceArea elsewhere in the app.
 * Falls back to a fresh default list for a job whose stored value isn't
 * a valid checklist (never saved yet, or a shape from before this
 * feature existed). */
export function parseChecklist(value: unknown, type: JobType): ChecklistItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultChecklistFor(type);
  }
  const parsed = value.filter(
    (v): v is ChecklistItem =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as ChecklistItem).item === "string" &&
      typeof (v as ChecklistItem).checked === "boolean",
  );
  return parsed.length > 0 ? parsed : defaultChecklistFor(type);
}

export function checklistProgress(checklist: ChecklistItem[]): { done: number; total: number } {
  return { done: checklist.filter((i) => i.checked).length, total: checklist.length };
}
