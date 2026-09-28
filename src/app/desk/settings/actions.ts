"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  updateBusinessSettings,
  updateAppliancePrice,
  setApplianceVisibility,
  createApplianceType,
  setApplianceTypeActive,
  setAppliancePhotoUrl,
} from "@/domains/settings";
import {
  createStaffAccount,
  deactivateStaffAccount,
  reactivateStaffAccount,
  resendStaffActivationEmail,
} from "@/domains/staff";
import { dollarsToCents } from "@/domains/pricing";

// Fee fields are entered on the form as real dollars (e.g. 45.00) — see
// settings-form.tsx — and converted to integer cents right here, in the
// one place that talks to the database, per docs/BUSINESS-RULES.md
// ("money is stored as integer cents, never floating point").
const businessSettingsSchema = z.object({
  publicBusinessName: z.string().trim().min(1).max(200),
  publicPhone: z.string().trim().min(1).max(30),
  publicEmail: z.string().trim().email(),
  publicAddress: z.string().trim().min(1).max(300),
  serviceAreaCities: z.string().trim(),
  serviceAreaZips: z.string().trim(),
  deliveryFeeDollars: z.coerce.number().min(0).max(100000),
  installationFeeDollars: z.coerce.number().min(0).max(100000),
  removalFeeDollars: z.coerce.number().min(0).max(100000),
  damageWaiverEnabled: z.coerce.boolean(),
  depositEnabled: z.coerce.boolean(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(90),
  lateFeeFlatDollars: z.coerce.number().min(0).max(100000),
  lateFeePercent: z.coerce.number().int().min(0).max(100),
  taxRatePermille: z.coerce.number().int().min(0).max(1000),
  taxRateConfirmed: z.coerce.boolean(),
  sixMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  sixMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepayFreeMonthEnabled: z.coerce.boolean(),
  draftReservationHoldDays: z.coerce.number().int().min(1).max(90),
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

  const {
    serviceAreaCities,
    serviceAreaZips,
    deliveryFeeDollars,
    installationFeeDollars,
    removalFeeDollars,
    lateFeeFlatDollars,
    sixMonthPrepaySetDollars,
    sixMonthPrepaySingleDollars,
    twelveMonthPrepaySetDollars,
    twelveMonthPrepaySingleDollars,
    ...rest
  } = parsed.data;

  await updateBusinessSettings(session.user.id, {
    ...rest,
    oneTimeDeliveryFeeCents: dollarsToCents(deliveryFeeDollars),
    oneTimeInstallationFeeCents: dollarsToCents(installationFeeDollars),
    oneTimeRemovalFeeCents: dollarsToCents(removalFeeDollars),
    lateFeeFlatCents: dollarsToCents(lateFeeFlatDollars),
    sixMonthPrepayDiscountSetCents: dollarsToCents(sixMonthPrepaySetDollars),
    sixMonthPrepayDiscountSingleCents: dollarsToCents(sixMonthPrepaySingleDollars),
    twelveMonthPrepayDiscountSetCents: dollarsToCents(twelveMonthPrepaySetDollars),
    twelveMonthPrepayDiscountSingleCents: dollarsToCents(twelveMonthPrepaySingleDollars),
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
    dollarsToCents(newPriceDollars),
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

const newApplianceTypeSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  monthlyPriceDollars: z.coerce.number().min(0).max(100000),
});

export async function createApplianceTypeAction(
  raw: unknown,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newApplianceTypeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    await createApplianceType(session.user.id, {
      name: parsed.data.name,
      monthlyPriceCents: dollarsToCents(parsed.data.monthlyPriceDollars),
    });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not create that appliance type.",
    };
  }

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}

const photoUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), {
    message: "Enter a full image URL starting with https://, or leave blank.",
  });

export async function setAppliancePhotoUrlAction(
  applianceTypeId: string,
  rawPhotoUrl: string,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = photoUrlSchema.safeParse(rawPhotoUrl);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid image URL.",
    };
  }

  await setAppliancePhotoUrl(
    session.user.id,
    applianceTypeId,
    parsed.data === "" ? null : parsed.data,
  );

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}

export async function setApplianceTypeActiveAction(
  applianceTypeId: string,
  isActive: boolean,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  await setApplianceTypeActive(session.user.id, applianceTypeId, isActive);

  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");

  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Staff accounts (Task #66, docs/DECISIONS.md 2026-09-28) — OWNER/ADMIN
// only, same as everything else in this file.
// ---------------------------------------------------------------------------

const newStaffAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  email: z.string().trim().email("Enter a valid email address."),
});

export async function createStaffAccountAction(
  raw: Record<string, unknown>,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newStaffAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    await createStaffAccount(session.user.id, parsed.data);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't create that account.",
    };
  }

  revalidatePath("/desk/settings");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

export async function resendStaffActivationEmailAction(
  email: string,
): Promise<SettingsActionState> {
  await requireRole("OWNER", "ADMIN");

  const sent = await resendStaffActivationEmail(email);
  if (!sent) {
    return {
      status: "error",
      message: "Couldn't send that email right now — try again in a minute.",
    };
  }

  return { status: "success" };
}

export async function deactivateStaffAccountAction(
  staffUserId: string,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await deactivateStaffAccount(session.user.id, staffUserId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't remove that account's access.",
    };
  }

  revalidatePath("/desk/settings");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

export async function reactivateStaffAccountAction(
  staffUserId: string,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  try {
    await reactivateStaffAccount(session.user.id, staffUserId);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't restore that account.",
    };
  }

  revalidatePath("/desk/settings");
  revalidatePath("/desk/activity");

  return { status: "success" };
}
