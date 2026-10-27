import { prisma } from "@/lib/prisma";
import { RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS } from "./rules";

export async function listDisputes() {
  const rows = await prisma.paymentDispute.findMany({
    orderBy: [{ openedAt: "desc" }],
    take: 200,
    select: {
      id: true, amountCents: true, reason: true, state: true, isBank: true, dueBy: true, openedAt: true,
      evidenceSubmittedAt: true, evidenceFileId: true, handledAt: true, outcome: true,
      customer: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });
  return rows.map((row) => ({
    ...row,
    customerName: row.customer?.user.name ?? row.customer?.user.email ?? "Unknown customer",
  }));
}

export async function getDispute(id: string) {
  const row = await prisma.paymentDispute.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, bankDebitBlockedAt: true, bankDebitBlockedReason: true, user: { select: { name: true, email: true } } } },
      invoice: { select: { id: true, invoiceNumber: true } },
    },
  });
  if (!row) return null;
  return { ...row, customerName: row.customer?.user.name ?? row.customer?.user.email ?? "Unknown customer" };
}

export async function getAchDisputeWindowDays(): Promise<number> {
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { achDisputeWindowDays: true } });
  return settings?.achDisputeWindowDays ?? RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS;
}
