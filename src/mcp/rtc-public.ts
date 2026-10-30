/** Public RTC 1 metadata is deliberately independent of authentication paths.
 * Keep this list synchronized with the actual SDK registerTool calls; the
 * accompanying drift test enforces exact names and read/write annotations.
 */
export const RTC_PUBLIC_CATALOG = [
  {
    "name": "appliance_whoami",
    "readOnly": true
  },
  {
    "name": "appliance_health_get_overview",
    "readOnly": true
  },
  {
    "name": "appliance_health_list_issues",
    "readOnly": true
  },
  {
    "name": "appliance_health_get_issue",
    "readOnly": true
  },
  {
    "name": "appliance_automation_list_runs",
    "readOnly": true
  },
  {
    "name": "appliance_configuration_get_readiness",
    "readOnly": true
  },
  {
    "name": "appliance_backup_get_status",
    "readOnly": true
  },
  {
    "name": "appliance_decisions_list",
    "readOnly": true
  },
  {
    "name": "appliance_decisions_get",
    "readOnly": true
  },
  {
    "name": "appliance_feedback_list_reports",
    "readOnly": true
  },
  {
    "name": "appliance_feedback_get_report",
    "readOnly": true
  },
  {
    "name": "appliance_repair_list_cases",
    "readOnly": true
  },
  {
    "name": "appliance_repair_get_case",
    "readOnly": true
  },
  {
    "name": "appliance_action_preview",
    "readOnly": false
  },
  {
    "name": "appliance_feedback_reply",
    "readOnly": false
  },
  {
    "name": "appliance_feedback_update_report",
    "readOnly": false
  },
  {
    "name": "appliance_feedback_link_case",
    "readOnly": false
  },
  {
    "name": "appliance_repair_create_case",
    "readOnly": false
  },
  {
    "name": "appliance_repair_link_evidence",
    "readOnly": false
  },
  {
    "name": "appliance_repair_check",
    "readOnly": false
  },
  {
    "name": "appliance_action_execute",
    "readOnly": false
  },
  {
    "name": "appliance_operation_get",
    "readOnly": true
  }
] as const;

export function rtcPublicManifest() {
  return {
    rtc: 1, server: "Appliance Desk", prefix: "appliance", version: "1.0.0", apiVersion: "1",
    areas: ["health", "automation", "decisions", "configuration", "backup", "feedback", "repair", "optimization"],
    counts: { tools: RTC_PUBLIC_CATALOG.length,
      writes: RTC_PUBLIC_CATALOG.filter(item => !item.readOnly).length, money: 0 },
    profiles: ["read_only"], listingModes: ["catalog", "compact"],
    modes: ["test", "production"], devTools: false,
  };
}
