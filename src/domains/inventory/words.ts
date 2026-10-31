import type { ApplianceStatus } from "@prisma/client";
import { APPLIANCE_STATUS_LABELS } from "./lifecycle";

/**
 * AR-6 section 2: the shared words for equipment. Pure — no database, no
 * session. Pill tones use the kit's vocabulary spelled out here (the
 * jobs/words.ts pattern) so the domain stays free of component imports;
 * the shapes are assignable to the kit StatusPill props.
 */
export type PillTone = "info" | "attention" | "good" | "neutral" | "danger";
export type PillSpec = { label: string; tone: PillTone };

export const APPLIANCE_PILL: Record<ApplianceStatus, PillSpec> = {
  AVAILABLE: { label: APPLIANCE_STATUS_LABELS.AVAILABLE, tone: "good" },
  RESERVED: { label: APPLIANCE_STATUS_LABELS.RESERVED, tone: "info" },
  RENTED: { label: APPLIANCE_STATUS_LABELS.RENTED, tone: "info" },
  AWAITING_PICKUP: { label: APPLIANCE_STATUS_LABELS.AWAITING_PICKUP, tone: "attention" },
  AWAITING_INSPECTION: { label: APPLIANCE_STATUS_LABELS.AWAITING_INSPECTION, tone: "attention" },
  CLEANING: { label: APPLIANCE_STATUS_LABELS.CLEANING, tone: "attention" },
  MAINTENANCE: { label: APPLIANCE_STATUS_LABELS.MAINTENANCE, tone: "attention" },
  RETIRED: { label: APPLIANCE_STATUS_LABELS.RETIRED, tone: "neutral" },
};

/** The chip shown when an open out-of-service period exists. */
export const AWAY_FOR_REPAIR_PILL: PillSpec = { label: "Away for repair", tone: "attention" };

type ApplianceWords = {
  assetNumber: string;
  manufacturer?: string | null;
  model?: string | null;
  color?: string | null;
  applianceType: { name: string };
};

export function applianceTitle(a: ApplianceWords): string {
  return `${a.applianceType.name} #${a.assetNumber}`;
}

export function applianceSubtitle(a: ApplianceWords): string {
  const parts = [a.manufacturer, a.model, a.color].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : "No make or model yet";
}
