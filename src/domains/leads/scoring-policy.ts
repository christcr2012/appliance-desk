import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  leadScoringPolicySchema,
  parseLeadScoringPolicy,
  type LeadScoringPolicy,
  type LeadScoringPolicyInput,
} from "./scoring-policy-config";

export {
  DEFAULT_LEAD_SCORING_POLICY,
  leadScoringPolicySchema,
  parseLeadScoringPolicy,
} from "./scoring-policy-config";
export type { LeadScoringPolicy, LeadScoringPolicyInput } from "./scoring-policy-config";

export async function getLeadScoringPolicy(): Promise<LeadScoringPolicy> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { leadScoringPolicy: true },
  });
  return parseLeadScoringPolicy(settings?.leadScoringPolicy);
}

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
    const next: LeadScoringPolicy = { ...validatedInput, version: before.version + 1 };

    await tx.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", leadScoringPolicy: next as unknown as Prisma.InputJsonValue },
      update: { leadScoringPolicy: next as unknown as Prisma.InputJsonValue },
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
