// AR-8 (SETTINGS spec section 6): the read side of the settings page —
// read-only. One settings read, the section's visible rows with their
// display text, per-row revision and last change (one audit query walked
// newest first), and the DEC-1 state for rows a decision owns.

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getBusinessSettings } from "./index";
import { fieldsRevision } from "./preview";
import { describeSettingsChange, formatSettingValue } from "./history";
import {
  rowsForSection,
  type SettingRowDef,
  type SettingsSectionId,
} from "./catalog";
import { getShownFeatures } from "@/domains/features";
import { listDecisions } from "@/domains/decisions";

/** DEC-1's decisions pages are in the tree (settings/decisions), so the section renders live. */
export const HAS_DECISIONS_CENTER = true;

export type SettingsPageRow = {
  def: SettingRowDef;
  /** The stored value for a field row; for a panel, an object of its covered fields' values. */
  value: unknown;
  display: string;
  revision: string;
  lastChange: { by: string; at: Date } | null;
  state?: "starting" | "confirmed" | "needs-setup";
  editable: boolean;
  /** The decision's recommended value at render time, when this row is owned by a DEC-1 subject. */
  recommended?: unknown;
};

export type SettingsPage = {
  role: "OWNER" | "ADMIN";
  section: SettingsSectionId;
  rows: SettingsPageRow[];
  /** Sections holding at least one row in an attention state (the nav dot). */
  attentionSections: SettingsSectionId[];
};

const AUDIT_ACTIONS_BASE = ["settings.update", "settings.undo"];

function kindForFormat(def: SettingRowDef) {
  switch (def.kind) {
    case "money": return "money" as const;
    case "days": return "days" as const;
    case "hours": return "hours" as const;
    case "percent": return "percent" as const;
    case "yesno": return "yesno" as const;
    case "number": return "number" as const;
    case "list": return "list" as const;
    case "choice": return "choice" as const;
    default: return "text" as const;
  }
}

export async function getSettingsPage(sectionId: SettingsSectionId): Promise<SettingsPage> {
  const session = await requireRole("OWNER", "ADMIN");
  const role = session.user.role as "OWNER" | "ADMIN";
  const [settings, shownFeatures] = await Promise.all([getBusinessSettings(), getShownFeatures()]);
  const row = settings as unknown as Record<string, unknown>;

  const allRows = rowsForSection(sectionId);
  const visible = allRows.filter((def) => !def.feature || shownFeatures.has(def.feature));

  // One audit query for every row's last change: newest 300 rows across the
  // plain save actions and every domain writer's own action in the catalog.
  const domainActions = [...new Set(visible.flatMap((def) => def.auditActions ?? []))];
  const auditRows = await prisma.auditLog.findMany({
    where: { action: { in: [...AUDIT_ACTIONS_BASE, ...domainActions] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      action: true, oldValue: true, newValue: true, createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  const actionToKey = new Map<string, string>();
  for (const def of visible) for (const a of def.auditActions ?? []) actionToKey.set(a, def.key);
  const lastChangeByKey = new Map<string, { by: string; at: Date }>();
  for (const r of auditRows) {
    const by = r.user?.name || r.user?.email || "Someone";
    const domainKey = actionToKey.get(r.action);
    if (domainKey && !lastChangeByKey.has(domainKey)) {
      lastChangeByKey.set(domainKey, { by, at: r.createdAt });
    }
    for (const change of describeSettingsChange(r.oldValue, r.newValue)) {
      if (!lastChangeByKey.has(change.key)) lastChangeByKey.set(change.key, { by, at: r.createdAt });
    }
  }

  // DEC-1 states + recommended values for the rows a decision owns (one call).
  const decisionIds = new Set(visible.map((d) => d.decisionId).filter(Boolean) as string[]);
  const decisionById = new Map<string, { state: string; recommended: unknown }>();
  if (decisionIds.size > 0 && HAS_DECISIONS_CENTER) {
    const cards = await listDecisions(session.user.id).catch(() => []);
    for (const card of cards) {
      const ids = [card.id, ...(card.legacyIds ?? [])];
      for (const id of ids) {
        if (decisionIds.has(id)) {
          decisionById.set(id, {
            state: card.state,
            recommended: (card.recommended as { value?: unknown } | undefined)?.value,
          });
        }
      }
    }
  }

  const rows: SettingsPageRow[] = visible.map((def) => {
    const isFieldRow = def.editor === "row" || (typeof def.editor === "object" && "domainWriter" in def.editor);
    const value = isFieldRow
      ? row[def.key]
      : Object.fromEntries((def.covers ?? []).map((f) => [f, row[f]]));
    const decision = def.decisionId ? decisionById.get(def.decisionId) : undefined;
    return {
      def,
      value,
      display: isFieldRow ? formatSettingValue(kindForFormat(def), value) : "",
      revision: fieldsRevision(row, [def.key]),
      lastChange: lastChangeByKey.get(def.key) ?? null,
      state:
        decision?.state === "STARTING_VALUE" ? "starting"
        : decision?.state === "CONFIRMED" ? "confirmed"
        : undefined,
      editable: def.who === "finance" || role === "OWNER",
      recommended: decision ? decision.recommended : def.recommended,
    };
  });

  const attentionSections = new Set<SettingsSectionId>();
  for (const r of rows) if (r.state === "starting" || r.state === "needs-setup") attentionSections.add(sectionId);

  return { role, section: sectionId, rows, attentionSections: [...attentionSections] };
}
