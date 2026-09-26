"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  updateBusinessSettings,
  updateAppliancePrice,
  setApplianceVisibility,
} from "@/domains/settings";

const businessSettingsSchema = z.object({
  publicBusinessName: z.string().trim().min(1).max(200),
  publicPhone: z.string().trim().min(1).max(30),
  publicEmail: z.string().trim().email(),
  publicAddress: z.string().trim().min(1).max(300),
  serviceAreaCities: z.string().trim(),
  serviceAreaZips: z.string().trim(),
  oneTimeDeliveryFeeCents: z.coerce.number().int().min(0),
  oneTimeRemovalFeeCents: z.coerce.number().int().min(0),
  damageWaiverEnabled: z.coerce.boolean(),
  depositEnabled: z.coerce.boolean(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(90),
  lateFeeFlatCents: z.coerce.number().int().min(0),
  lateFeePercent: z.coerce.number().int().min(0).max(100),
  taxRatePermille: z.coerce.number().int().min(0).max(1000),
  taxRateConfirmed: z.coerce.boolean(),
});

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export type SettingsActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function updateSettingsAction(
  raw: Record<string, unknown>,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = businessSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fix the highlighted fields." };
  }

  const { serviceAreaCities, serviceAreaZips, ...rest } = parsed.data;

  await updateBusinessSettings(session.user.id, {
    ...rest,
    serviceAreaCities: splitList(serviceAreaCities),
    serviceAreaZips: splitList(serviceAreaZips),
  });

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}

export async function updateAppliancePriceAction(
  applianceTypeId: string,
  newPriceDollars: number,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!Number.isFinite(newPriceDollars) || newPriceDollars < 0) {
    return { status: "error", message: "Enter a valid price." };
  }

  await updateAppliancePrice(
    session.user.id,
    applianceTypeId,
    Math.round(newPriceDollars * 100),
  );

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}

export async function setApplianceVisibilityAction(
  applianceTypeId: string,
  showOnWebsite: boolean,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  await setApplianceVisibility(session.user.id, applianceTypeId, showOnWebsite);

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}
