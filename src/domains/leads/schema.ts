import { z } from "zod";

// The one source of truth for what the public lead form collects, per
// docs/BUSINESS-RULES.md: "individual vs. business, landlord/property-
// manager status, appliances needed + quantity, desired term, service
// address (and whether it's inside the service area), desired start
// date, name, phone (required), email (encouraged), best time to
// contact, how they heard about us, notes, and a required privacy/terms
// consent checkbox." Shared by the client form (react-hook-form) and the
// server action, so validation can never drift between the two.
export const leadFormSchema = z.object({
  accountType: z.enum(["individual", "business"]),
  isPropertyManager: z.boolean(),
  companyName: z.string().trim().max(200).optional().or(z.literal("")),

  contactName: z.string().trim().min(2, "Enter your name").max(200),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid phone number")
    .max(20),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
  bestTimeToContact: z.string().trim().max(200).optional().or(z.literal("")),
  howHeard: z.string().trim().max(200).optional().or(z.literal("")),
  // Task #68 (referral program) — an optional code a friend gave them.
  // Validated only for a sane max length here; matching against a real
  // customer's code happens server-side at conversion, not here, so a
  // typo or made-up code never blocks submitting the lead itself.
  referralCode: z.string().trim().max(20).optional().or(z.literal("")),

  applianceTypeIds: z
    .array(z.string())
    .min(1, "Select at least one appliance"),
  quantity: z.number().int().min(1).max(50),
  desiredTerm: z.enum(["month-to-month", "6-month", "12-month"]),
  desiredStartDate: z.string().trim().optional().or(z.literal("")),

  addressLine1: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  zip: z
    .string()
    .trim()
    .max(10)
    .optional()
    .or(z.literal("")),

  notes: z.string().trim().max(2000).optional().or(z.literal("")),

  consent: z.boolean().refine((v) => v === true, {
    message: "You must agree to the privacy policy and terms to continue",
  }),

  // Honeypot (Phase 6A item 7 — spam protection): a field real visitors
  // never see or fill in (hidden off-screen in contact-form.tsx). Any
  // value here means an automated submission, not a real one — see
  // submitLead in src/app/(public)/contact/actions.ts, which checks this
  // and silently drops the submission without ever saving a Lead.
  // Deliberately never persisted onto the Lead record itself.
  website: z.string().max(200).optional().or(z.literal("")),
});

export type LeadFormInput = z.infer<typeof leadFormSchema>;
