import { z } from "zod";
import { parseTaxRatePercent } from "@/domains/billing/tax";
export const businessSettingsSchema = z.object({
  publicBusinessName: z.string().trim().min(1).max(200),
  publicPhone: z.string().trim().min(1).max(30),
  publicEmail: z.string().trim().email(),
  publicAddress: z.string().trim().min(1).max(300),
  serviceAreaCities: z.string().trim(),
  serviceAreaZips: z.string().trim(),
  deliveryFeeDollars: z.coerce.number().min(0).max(100000),
  installationFeeDollars: z.coerce.number().min(0).max(100000),
  removalFeeDollars: z.coerce.number().min(0).max(100000),
  damageWaiverEnabled: z.boolean(),
  depositEnabled: z.boolean(),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(90),
  lateFeeFlatDollars: z.coerce.number().min(0).max(100000),
  lateFeePercent: z.coerce.number().int().min(0).max(100),
  // Owner types an ordinary percentage ("7.375"); stored exactly as thousandths of a percent.
  taxRatePercentText: z
    .string()
    .trim()
    .refine((text) => {
      try {
        parseTaxRatePercent(text);
        return true;
      } catch {
        return false;
      }
    }, "Enter the tax rate as a percentage with up to three decimal places, such as 7.375."),
  taxRateConfirmed: z.boolean(),
  sixMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  sixMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepayFreeMonthEnabled: z.boolean(),
  referralRewardDollars: z.coerce.number().min(0).max(1000),
  draftReservationHoldDays: z.coerce.number().int().min(1).max(90),
});
