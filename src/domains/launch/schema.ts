import { z } from "zod";

export const LAUNCH_CONSENT_VERSION = "2026-09-29-v1";
export const LAUNCH_CONSENT =
  "Email me launch news and appliance-rental information from Robinson Appliance Rentals. I can unsubscribe at any time.";

export const launchSignupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(100),
  email: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .max(254)
    .transform((v) => v.toLowerCase()),
  city: z.string().trim().min(2, "Please enter your city.").max(100),
  interest: z.enum([
    "Washer and dryer",
    "Washer",
    "Dryer",
    "Multiple properties",
    "Still deciding",
  ]),
  consent: z.literal(true, {
    error: "Please agree to receive the emails before joining.",
  }),
  source: z.string().trim().max(100).default("website"),
  website: z.string().max(200).default(""),
});

export const launchSettingsSchema = z
  .object({
    prelaunchMode: z.boolean(),
    emailEnabled: z.boolean(),
    postalAddress: z.string().trim().max(500),
    replyToEmail: z.union([z.email(), z.literal("")]),
  })
  .superRefine((v, ctx) => {
    if (v.emailEnabled && v.postalAddress.length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["postalAddress"],
        message:
          "Enter your valid business mailing address before enabling emails.",
      });
    }
    if (v.emailEnabled && !v.replyToEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["replyToEmail"],
        message: "Enter a monitored reply email before enabling emails.",
      });
    }
  });

export type LaunchSignup = z.infer<typeof launchSignupSchema>;
export type LaunchFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: Record<string, string[]>;
};
