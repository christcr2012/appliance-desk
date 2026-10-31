import { SETTING_ROWS } from "@/domains/settings/catalog";
import { DECISION_SUBJECTS } from "@/domains/decisions/registry";

/**
 * MCP-8 setting discovery derives owner settings from the maintained AR-8 catalog.
 * Only extra System health controls live here; no duplicate settings table.
 */
export type SettingMapItem = {
  key: string; label: string; href: string; who: string;
  mcpStatus: "TOOL" | "PLANNED" | "NOT_APPLICABLE" | "PROVIDER_MANUAL";
  reason: string;
  action?: string;
  keywords: string[];
};

export const SYSTEM_HEALTH_CONTROLS: ReadonlyArray<SettingMapItem> = [
  { key: "systemHealth.automationPause", label: "Pause an automation", href: "/desk/automations",
    who: "OWNER", mcpStatus: "TOOL", action: "PAUSE_AUTOMATION",
    reason: "An assistant can preview this action; the owner must approve it.", keywords: ["stop", "automation", "pause"] },
  { key: "systemHealth.automationResume", label: "Resume an automation", href: "/desk/automations",
    who: "OWNER", mcpStatus: "TOOL", action: "RESUME_AUTOMATION",
    reason: "An assistant can preview this action; the owner must approve it.", keywords: ["start", "automation", "resume"] },
  { key: "systemHealth.backupRetry", label: "Retry a failed database backup", href: "/desk/automations#backup-settings",
    who: "OWNER", mcpStatus: "TOOL", action: "RETRY_DATABASE_BACKUP",
    reason: "Available only when an existing backup failed; owner approval is required.", keywords: ["backup", "recovery", "retry"] },
  { key: "systemHealth.monitorRules", label: "Monitoring rules and standing assistant approvals", href: "/desk/automations#monitoring",
    who: "OWNER", mcpStatus: "PLANNED",
    reason: "Change rules in System health; the assistant has no general rule editor.", keywords: ["monitor", "alert", "threshold", "standing"] },
  { key: "systemHealth.monitorEmail", label: "Monitoring alert email", href: "/desk/automations#monitoring",
    who: "OWNER", mcpStatus: "PLANNED",
    reason: "Edit the rule's email checkbox in System health.", keywords: ["monitor", "email", "notification"] },
  { key: "systemHealth.backupRetention", label: "Keep backups for a number of days", href: "/desk/automations#backup-settings",
    who: "OWNER", mcpStatus: "PLANNED",
    reason: "The owner sets this in System health; no assistant writer is authorized.", keywords: ["backup", "retention"] },
  { key: "systemHealth.lateGrace", label: "When scheduled work is considered late", href: "/desk/automations#late-grace",
    who: "OWNER", mcpStatus: "PLANNED",
    reason: "Change the grace period in System health.", keywords: ["late", "jobs", "minutes"] },
  { key: "systemHealth.repairCases", label: "Repair cases", href: "/desk/automations",
    who: "OWNER or ADMIN", mcpStatus: "TOOL", action: "REPAIR_CREATE_CASE",
    reason: "A scoped assistant can propose a repair case; ownership and source evidence are checked.", keywords: ["repair", "bug", "case"] },
  { key: "systemHealth.assistantConnections", label: "Assistant connections and revocation", href: "/desk/automations",
    who: "OWNER", mcpStatus: "NOT_APPLICABLE",
    reason: "Only the signed-in account owner can authorize or revoke their assistant.", keywords: ["assistant", "connection", "revoke", "oauth"] },
  { key: "systemHealth.systemIssues", label: "System problems and owner notes", href: "/desk/automations",
    who: "OWNER", mcpStatus: "PLANNED",
    reason: "Assistants can read system problems; changing their owner status is a separate permission.", keywords: ["issues", "problems", "notes"] },
  { key: "systemHealth.opsKeys", label: "Operations agent keys", href: "/desk/automations",
    who: "OWNER", mcpStatus: "NOT_APPLICABLE",
    reason: "Keys are issued and revoked through the owner screen only.", keywords: ["keys", "credential", "agent"] },
  { key: "systemHealth.backupStorageProvider", label: "Backup storage capacity and provider permissions", href: "/desk/automations#backup-settings",
    who: "OWNER", mcpStatus: "PROVIDER_MANUAL",
    reason: "Change the verified storage provider directly; no assistant permission or expenditure is implied.", keywords: ["provider", "storage", "capacity"] },
];

export function buildSettingsMap(): SettingMapItem[] {
  const settings: SettingMapItem[] = SETTING_ROWS.map(row => {
    const href = typeof row.editor === "object" && "panelHref" in row.editor
      ? row.editor.panelHref
      : "/desk/settings?section=" + encodeURIComponent(row.section);
    return {
      key: row.key, label: row.label, href,
      who: row.who === "finance" ? "OWNER or FINANCE" : "OWNER",
      mcpStatus: "PLANNED",
      reason: row.section === "money" || row.section === "prices" || row.kind === "money"
        ? "Financial settings must be changed in Settings; assistants cannot tune prices, fees or taxes."
        : "Change this setting in Settings; an assistant editor needs a separately approved action.",
      keywords: [row.section, ...(row.keywords ?? [])],
    };
  });
  const decisions: SettingMapItem[] = DECISION_SUBJECTS.map(subject => ({
    key: "decision." + subject.id, label: subject.title,
    href: subject.affects[0]?.href ?? "/desk/settings/decisions",
    who: subject.audience === "OWNER" ? "OWNER" : "OWNER with " + subject.audience,
    mcpStatus: "TOOL" as const, action: "APPLY_DECISION_ANSWERS",
    reason: "Requires an authorized decisions:apply assistant grant and validated answer evidence.",
    keywords: [subject.area, subject.question.slice(0, 100)],
  }));
  return [...settings, ...SYSTEM_HEALTH_CONTROLS, ...decisions];
}

export function findSettings(query: string, limit = 8): SettingMapItem[] {
  const needle = query.toLocaleLowerCase("en-US").trim().slice(0, 100);
  if (needle.length < 2) return [];
  return buildSettingsMap().map(item => {
    const key = item.key.toLowerCase(), label = item.label.toLowerCase();
    const words = item.keywords.join(" ").toLowerCase();
    const score = key === needle || label === needle ? 5 :
      key.startsWith(needle) || label.startsWith(needle) ? 4 :
      label.includes(needle) || key.includes(needle) ? 3 :
      words.includes(needle) ? 2 : 0;
    return { item, score };
  }).filter(result => result.score > 0).sort((a, b) =>
    b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, Math.max(1, Math.min(limit, 20))).map(result => result.item);
}
