import { z } from "zod";

const taxRatePercent = z.coerce
  .number()
  .min(0)
  .max(100)
  .refine(
    (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8,
    "Tax rate can have at most three decimal places.",
  );

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
  // Owner-facing value is a normal percentage such as 7.375. The server
  // converts it to integer thousandths of one percentage point for storage.
  taxRatePercent,
  taxRateConfirmed: z.boolean(),
  sixMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  sixMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySetDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepaySingleDollars: z.coerce.number().min(0).max(1000),
  twelveMonthPrepayFreeMonthEnabled: z.boolean(),
  referralRewardDollars: z.coerce.number().min(0).max(1000),
  draftReservationHoldDays: z.coerce.number().int().min(1).max(90),
});
