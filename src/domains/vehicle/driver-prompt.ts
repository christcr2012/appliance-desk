// OPS-3: which odometer reminder the driver's route calls for. Pure, so it can be tested without a database.
export type PromptTrip = { endOdometer: number | null } | null;

/** Before the first stop (no trip yet today), or after the last stop (every stop finished, trip still open). */
export function mileagePrompt(stops: { total: number; finished: number }, trip: PromptTrip): "FIRST_STOP" | "LAST_STOP" | null {
  if (stops.total === 0) return null;
  if (!trip) return "FIRST_STOP";
  if (trip.endOdometer == null && stops.finished >= stops.total) return "LAST_STOP";
  return null;
}
