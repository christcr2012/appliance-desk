import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { updatePolicy } from "./workflow-text-settings";
import { type ServiceReportingSettings } from "./telecom-unit-economics";

/** Owner-only: the customer counts used in the what-if forecast and how much history is needed before a number is shown. */
export async function saveServiceReportingSettings(
  ownerUserId: string, input: { settings: ServiceReportingSettings | null; expectedVersion: number },
): Promise<{ version: number }> {
  const s = input.settings;
  if (s) {
    const counts = [...new Set(s.forecastScenarios)];
    if (counts.length < 1 || counts.length > 6 || counts.some((n) => !Number.isInteger(n) || n < 1 || n > 1_000_000)) {
      throw new Error("Enter between 1 and 6 customer counts, each a whole number from 1 to 1,000,000.");
    }
    if (!Number.isInteger(s.minForecastCustomerDays) || s.minForecastCustomerDays < 1 || s.minForecastCustomerDays > 3650) {
      throw new Error("History needed for a forecast must be a whole number of customer-days from 1 to 3,650.");
    }
    if (!Number.isInteger(s.minRateSample) || s.minRateSample < 1 || s.minRateSample > 10000) {
      throw new Error("Smallest sample for a rate must be a whole number from 1 to 10,000.");
    }
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, ownerUserId, ["OWNER"]);
    const version = await updatePolicy(tx, ownerUserId, input.expectedVersion, (p) => {
      const { serviceReporting: _drop, ...rest } = p; void _drop;
      return s ? { ...rest, serviceReporting: { forecastScenarios: [...new Set(s.forecastScenarios)].sort((a, b) => a - b),
        minForecastCustomerDays: s.minForecastCustomerDays, minRateSample: s.minRateSample } } : rest;
    }, { serviceReporting: s ?? "recommended" });
    return { version };
  });
}
