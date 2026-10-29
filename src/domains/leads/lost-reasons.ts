/**
 * The standard "why did we lose this lead" list, shared by the lead record's
 * actions panel and the AR-4b queue/record Mark-lost sheets so both screens
 * offer exactly the same words. (From Chris's CRM brainstorm — see
 * docs/DECISIONS.md.) "Other" always lets staff type something not on the
 * list; nothing here constrains what's actually stored (Lead.lostReason is
 * free text).
 */
export const LEAD_LOST_REASONS = [
  "Too expensive",
  "Went with a competitor",
  "Outside our service area",
  "Never heard back after contacting them",
  "Changed their mind / no longer needed",
] as const;

export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];
