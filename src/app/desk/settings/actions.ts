"use server";

import { businessSettingsSchema } from "@/domains/settings/form-schema";

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
import { parseTaxRatePercent } from "@/domains/billing/tax";

// Fee fields are entered on the form as real dollars (e.g. 45.00) — see
// settings-form.tsx — and converted to integer cents right here, in the
// one place that talks to the database, per docs/BUSINESS-RULES.md
// ("money is stored as integer cents, never floating point").

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
    referralRewardDollars,
    taxRatePercentText,
    ...rest
  } = parsed.data;

  try {
    await updateBusinessSettings(session.user.id, {
      ...rest,
      taxRateMilliPercent: parseTaxRatePercent(taxRatePercentText),
      oneTimeDeliveryFeeCents: dollarsToCents(deliveryFeeDollars),
      oneTimeInstallationFeeCents: dollarsToCents(installationFeeDollars),
      oneTimeRemovalFeeCents: dollarsToCents(removalFeeDollars),
      lateFeeFlatCents: dollarsToCents(lateFeeFlatDollars),
      sixMonthPrepayDiscountSetCents: dollarsToCents(sixMonthPrepaySetDollars),
      sixMonthPrepayDiscountSingleCents: dollarsToCents(
        sixMonthPrepaySingleDollars,
      ),
      twelveMonthPrepayDiscountSetCents: dollarsToCents(
        twelveMonthPrepaySetDollars,
      ),
      twelveMonthPrepayDiscountSingleCents: dollarsToCents(
        twelveMonthPrepaySingleDollars,
      ),
      referralRewardCents: dollarsToCents(referralRewardDollars),
      serviceAreaCities: splitList(serviceAreaCities),
      serviceAreaZips: splitList(serviceAreaZips),
    });
  } catch {
    return {
      status: "error",
      message:
        "Settings could not be saved. Your changes are still in the form; please try again.",
    };
  }

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
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
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
      message:
        error instanceof Error
          ? error.message
          : "Could not create that appliance type.",
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
): Promise<SettingsActionState & { activationEmailSent?: boolean }> {
  const session = await requireRole("OWNER", "ADMIN");

  const parsed = newStaffAccountSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }

  try {
    const result = await createStaffAccount(session.user.id, parsed.data);
    revalidatePath("/desk/settings");
    revalidatePath("/desk/activity");
    return { status: "success", activationEmailSent: result.activationEmailSent };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Couldn't create that account.",
    };
  }

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
      message:
        error instanceof Error
          ? error.message
          : "Couldn't remove that account's access.",
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
      message:
        error instanceof Error
          ? error.message
          : "Couldn't restore that account.",
    };
  }

  revalidatePath("/desk/settings");
  revalidatePath("/desk/activity");

  return { status: "success" };
}

/** Section saves whitelist fields on the server, never write stale fields
 * from other sections, and retain the existing settings/audit source of truth. */
export async function updateSettingsSectionAction(
  section: string,
  raw: Record<string, unknown>,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const { settingsSectionUpdate } = await import("@/domains/settings/sections");
  const parsed = settingsSectionUpdate(section, raw);
  if (!parsed.success) return { status: "error", message: parsed.message };
  try {
    await updateBusinessSettings(session.user.id, parsed.update);
  } catch {
    return {
      status: "error",
      message:
        "Settings could not be saved. Your changes are still in the form; please try again.",
    };
  }
  revalidatePath("/", "layout");
  revalidatePath("/desk/settings");
  return { status: "success" };
}

/** Saves the "Ending and renewing rentals" policy. Blank fields are saved as
 * "not decided yet"; the auto-renew terms version is generated, never typed. */
export async function updateTermsPolicyAction(
  raw: Record<string, unknown>,
): Promise<SettingsActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const { termsPolicyUpdate } = await import("@/domains/settings/terms-policy");
  const parsed = termsPolicyUpdate(raw);
  if (!parsed.success) return { status: "error", message: parsed.message };
  try {
    await updateBusinessSettings(session.user.id, parsed.update);
  } catch {
    return {
      status: "error",
      message:
        "Settings could not be saved. Your changes are still in the form; please try again.",
    };
  }
  revalidatePath("/desk/settings");
  return { status: "success" };
}

/** The owner's master switch for emails to customers. Owner only. */
export async function setCustomerEmailAction(enabled: boolean): Promise<SettingsActionState> {
  const session = await requireRole("OWNER");
  const { setCustomerEmailEnabled } = await import("@/domains/settings/customer-email-switch");
  try {
    await setCustomerEmailEnabled(session.user.id, enabled === true);
  } catch {
    return { status: "error", message: "That could not be saved. Nothing was changed." };
  }
  revalidatePath("/desk/settings");
  revalidatePath("/desk/notices");
  return { status: "success" };
}

/** The owner's master switch for automatic renewals. Owner only. */
export async function setAutoRenewAction(enabled: boolean): Promise<SettingsActionState> {
  const session = await requireRole("OWNER");
  const { setAutoRenewEnabled } = await import("@/domains/settings/auto-renew-switch");
  try {
    await setAutoRenewEnabled(session.user.id, enabled === true);
  } catch {
    return { status: "error", message: "That could not be saved. Nothing was changed." };
  }
  revalidatePath("/desk/settings");
  return { status: "success" };
}
