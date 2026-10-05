import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

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

export const DEFAULT_LEAD_SCORING_POLICY: LeadScoringPolicy = {
  version: 1,
  termPoints: {
    "month-to-month": 0,
    "6-month": 10,
    "12-month": 20,
  },
  additionalUnitPoints: 5,
  businessAccountPoints: 10,
  multiUnitPropertyManagerPoints: 25,
  highValueThreshold: 30,
};

/** Reads fail closed to the documented v1 policy; writers reject invalid shapes. */
export function parseLeadScoringPolicy(raw: unknown): LeadScoringPolicy {
  const parsed = leadScoringPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_LEAD_SCORING_POLICY;
}

export async function getLeadScoringPolicy(): Promise<LeadScoringPolicy> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { leadScoringPolicy: true },
  });
  return parseLeadScoringPolicy(settings?.leadScoringPolicy);
}

export type LeadScoringPolicyInput = Omit<LeadScoringPolicy, "version">;

export async function saveLeadScoringPolicy(
  userId: string,
  input: LeadScoringPolicyInput,
): Promise<LeadScoringPolicy> {
  const validatedInput = leadScoringPolicySchema
    .omit({ version: true })
    .strict()
    .parse(input);

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const current = await tx.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { leadScoringPolicy: true },
    });
    const before = parseLeadScoringPolicy(current?.leadScoringPolicy);
    const next: LeadScoringPolicy = {
      ...validatedInput,
      version: before.version + 1,
    };

    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        leadScoringPolicy: next as unknown as Prisma.InputJsonValue,
      },
      update: {
        leadScoringPolicy: next as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.lead_scoring.update",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: before as unknown as Prisma.InputJsonValue,
        newValue: next as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });
}
