// AR-8 (SETTINGS spec section 5): cross-field rules for a settings save —
// the single place a rule that spans two stored fields lives. Pure: it
// reads the locked "before" row and the proposed update, and refuses a
// combination that cannot be true, so two people changing opposite ends
// of a window at once can never store an impossible window.

export class SettingsValidationError extends Error {}

const WINDOWS: { start: string; end: string }[] = [
  { start: "deliveryMorningStartHour", end: "deliveryMorningEndHour" },
  { start: "deliveryAfternoonStartHour", end: "deliveryAfternoonEndHour" },
];

export function validateSettingsCrossFields(
  before: Record<string, unknown>,
  update: Record<string, unknown>,
): void {
  const merged = { ...before, ...update };
  for (const w of WINDOWS) {
    if (update[w.start] === undefined && update[w.end] === undefined) continue;
    const start = merged[w.start];
    const end = merged[w.end];
    if (typeof start === "number" && typeof end === "number" && start >= end) {
      throw new SettingsValidationError("The window must start before it ends.");
    }
  }
}
