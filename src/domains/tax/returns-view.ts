import "server-only";
import type { FilingPacket, FilingPacketLoad } from "@/domains/tax/filing-packet";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";

function isFrozenPacket(value: unknown): value is FilingPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  if (!p.account || typeof p.account !== "object" || Array.isArray(p.account)) return false;
  const account = p.account as Record<string, unknown>;
  if (typeof account.id !== "string" || typeof account.name !== "string") return false;
  if (!Array.isArray(p.rows) || !Array.isArray(p.useTax) || !Array.isArray(p.steps)) return false;
  if (!p.totals || typeof p.totals !== "object") return false;
  return Number.isSafeInteger((p.totals as Record<string, unknown>).remitCents) &&
    typeof p.periodStart === "string" && typeof p.periodEnd === "string" &&
    typeof p.dueOn === "string";
}
export async function getPrivateReturn(periodId: string): Promise<{
  period: NonNullable<Awaited<ReturnType<typeof prisma.taxFilingPeriod.findUnique<{
    where: { id: string }; include: { filingAccount: true; amendments: true };
  }>>>>;
  result: FilingPacketLoad;
}> {
  await requireRole("OWNER", "ADMIN");
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(periodId)) throw new Error("Invalid return identifier.");
  const period = await prisma.taxFilingPeriod.findUnique({
    where: { id: periodId }, include: {
      filingAccount: true,
      amendments: { orderBy: [{ sequence: "desc" }], take: 25 },
    },
  });
  if (!period) throw new Error("Filing period not found.");
  if (period.status === "FILED") {
    return { period, result: isFrozenPacket(period.worksheet)
      ? { status: "READY", packet: period.worksheet }
      : { status: "BLOCKED", problems: ["The original frozen worksheet cannot be read. Do not recalculate filed returns from today's tax rules."] } };
  }
  return { period, result: await loadFilingPacket(periodId) };
}

