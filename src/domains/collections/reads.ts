import { prisma } from "@/lib/prisma";

export async function listCollectionWork() {
  const steps = await prisma.collectionStep.findMany({
    where: { state: "WAITING" },
    orderBy: [{ cameUpOn: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true, kind: true, cameUpOn: true, amountOwedCents: true, subject: true, body: true,
      invoice: { select: { id: true, invoiceNumber: true, agreementId: true } },
      customer: { select: { id: true, activeMilitary: true, user: { select: { name: true, email: true } } } },
    },
  });
  return steps;
}

export async function getCase(agreementId: string) {
  return prisma.collectionCase.findUnique({
    where: { agreementId },
    include: { customer: { select: { id: true, activeMilitary: true, user: { select: { name: true } } } } },
  });
}
