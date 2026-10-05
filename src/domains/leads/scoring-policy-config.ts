import { z } from "zod";

export const leadScoringPolicySchema = z.object({
  version: z.number().int().min(1),
  termPoints: z.object({
    "month-to-month": z.number().int().min(0).max(1000),
    "6-month": z.number().int().min(0).max(1000),
    "12-month": z.number().int().min(0).max(1000),
  }).strict(),
  additionalUnitPoints: z.number().int().min(0).max(1000),
  businessAccountPoints: z.number().int().min(0).max(1000),
  multiUnitPropertyManagerPoints: z.number().int().min(0).max(1000),
  highValueThreshold: z.number().int().min(0).max(10000),
}).strict();

export type LeadScoringPolicy = z.infer<typeof leadScoringPolicySchema>;
export type LeadScoringPolicyInput = Omit<LeadScoringPolicy, "version">;

export const DEFAULT_LEAD_SCORING_POLICY: LeadScoringPolicy = {
  version: 1,
  termPoints: { "month-to-month": 0, "6-month": 10, "12-month": 20 },
  additionalUnitPoints: 5,
  businessAccountPoints: 10,
  multiUnitPropertyManagerPoints: 25,
  highValueThreshold: 30,
};

export function parseLeadScoringPolicy(raw: unknown): LeadScoringPolicy {
  const parsed = leadScoringPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LEAD_SCORING_POLICY;
}
