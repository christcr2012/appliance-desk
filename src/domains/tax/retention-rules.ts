/** Pure rules for how long tax records are kept (W-15, IN-71); the save lives in retention.ts. */
export const RECOMMENDED_RETENTION_YEARS = 7;

export function retentionYearsProblem(years: unknown): string | null {
  return typeof years === "number" && Number.isInteger(years) && years >= 1 && years <= 50
    ? null : "Enter a whole number of years from 1 to 50.";
}
