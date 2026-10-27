import { prisma } from "@/lib/prisma";
import { renewalState, workersCompRequiredNow, type RenewalState } from "./rules";

export async function loadInsuranceOverview(now: Date) {
  const [settings, policies, requests] = await Promise.all([
    prisma.businessSettings.upsert({
      where: { id: "singleton" }, create: { id: "singleton" }, update: {},
      select: { insuranceRemindFirstDays: true, insuranceRemindSecondDays: true, workersCompStatus: true, workersCompEmployees: true, workersCompNote: true, workersCompFormSentOn: true, workersCompMailNumber: true },
    }),
    prisma.ownerInsurancePolicy.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { expiresOn: "asc" }], take: 200 }),
    prisma.insuranceCertificateRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 20, include: { policy: { select: { insurer: true, kind: true } } } }),
  ]);
  const withState = policies.map((p) => ({ ...p, state: renewalState(p.expiresOn, now, settings.insuranceRemindFirstDays, settings.insuranceRemindSecondDays) as RenewalState }));
  const activeWorkersComp = withState.some((p) => !p.archivedAt && p.kind === "WORKERS_COMP" && p.state.kind !== "expired");
  return {
    settings, policies: withState, requests,
    workersCompRequired: workersCompRequiredNow(settings.workersCompStatus, settings.workersCompEmployees, activeWorkersComp),
  };
}
