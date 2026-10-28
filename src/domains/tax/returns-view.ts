import "server-only";
import type { FilingPacket, FilingPacketLoad } from "@/domains/tax/filing-packet";
import { loadFilingPacket } from "@/domains/tax/filing-packet";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { maskReference } from "@/domains/paperwork/rules";

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
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(periodId)) throw new Error("Invalid return identifier.");
  const found = await prisma.taxFilingPeriod.findUnique({
    where: { id: periodId }, include: {
      filingAccount: true,
      amendments: { orderBy: [{ sequence: "desc" }], take: 25 },
    },
  });
  if (!found) throw new Error("Filing period not found.");
  // ACCT-1: an accountant may read a return, but filing account numbers are
  // masked for the role (spec: "filing accounts (account numbers masked)").
  const period = session.user.role === "ACCOUNTANT" && found.filingAccount
    ? { ...found, filingAccount: { ...found.filingAccount, accountNumber: found.filingAccount.accountNumber ? maskReference(found.filingAccount.accountNumber) : null } }
    : found;
  if (period.status === "FILED") {
    if (!isFrozenPacket(period.worksheet)) {
      return { period, result: { status: "BLOCKED", problems: ["The original frozen worksheet cannot be read. Do not recalculate filed returns from today's tax rules."] } };
    }
    const frozen = period.worksheet as FilingPacket;
    const packet = session.user.role === "ACCOUNTANT"
      ? { ...frozen, account: { ...frozen.account, accountNumber: frozen.account.accountNumber ? maskReference(frozen.account.accountNumber) : null } }
      : frozen;
    // Worksheets frozen before TFA-1 name the RDF grouping key rateId; the
    // current packet names it rateKey. Display only — the frozen row is never edited.
    if (packet.rdf) {
      packet.rdf = {
        ...packet.rdf,
        rows: packet.rdf.rows.map((row) => ({
          ...row,
          rateKey: row.rateKey ?? (row as unknown as { rateId?: string }).rateId ?? "",
        })),
      };
    }
    return { period, result: { status: "READY", packet } };
  }
  const live = await loadFilingPacket(periodId);
  if (session.user.role === "ACCOUNTANT" && live.status === "READY") {
    live.packet.account.accountNumber = live.packet.account.accountNumber
      ? maskReference(live.packet.account.accountNumber) : null;
  }
  return { period, result: live };
}

