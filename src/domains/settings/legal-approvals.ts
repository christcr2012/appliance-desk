import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";

export const LEGAL_PAGE_VERSIONS = {
  privacy: "2026-10-05-1",
  terms: "2026-10-05-1",
} as const;

export type LegalPage = keyof typeof LEGAL_PAGE_VERSIONS;
export type LegalApproval = {
  version: string;
  approvedOn: string;
  approvedBy: string;
};
export type LegalApprovals = Partial<Record<LegalPage, LegalApproval>>;

function approval(value: unknown): LegalApproval | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.version !== "string" ||
    typeof candidate.approvedOn !== "string" ||
    typeof candidate.approvedBy !== "string"
  ) {
    return undefined;
  }
  return {
    version: candidate.version,
    approvedOn: candidate.approvedOn,
    approvedBy: candidate.approvedBy,
  };
}

export function parseLegalApprovals(value: unknown): LegalApprovals {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const privacy = approval(source.privacy);
  const terms = approval(source.terms);
  return {
    ...(privacy ? { privacy } : {}),
    ...(terms ? { terms } : {}),
  };
}

export function isLegalPageApproved(
  value: unknown,
  page: LegalPage,
  version = LEGAL_PAGE_VERSIONS[page],
): boolean {
  return parseLegalApprovals(value)[page]?.version === version;
}

export async function approveLegalPage(userId: string, page: LegalPage): Promise<LegalApproval> {
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER"]);
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const settings = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { legalApprovals: true },
    });
    const before = parseLegalApprovals(settings.legalApprovals);
    const recorded: LegalApproval = {
      version: LEGAL_PAGE_VERSIONS[page],
      approvedOn: new Date().toISOString(),
      approvedBy: actor.name?.trim() || actor.email,
    };
    const next: LegalApprovals = { ...before, [page]: recorded };
    await tx.businessSettings.update({
      where: { id: "singleton" },
      data: { legalApprovals: next as Prisma.InputJsonObject },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "settings.legal_page.approve",
        entityType: "BusinessSettings",
        entityId: "singleton",
        oldValue: before as Prisma.InputJsonObject,
        newValue: { page, approval: recorded } as Prisma.InputJsonObject,
      },
    });
    return recorded;
  });
}
