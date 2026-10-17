import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

/**
 * W-17: "Related" links and a plain-words "History" for the seven main desk records.
 * Owner/admin only — the pages that show it are owner/admin pages, and every query
 * here re-checks the role. Links only ever point at pages that already exist.
 */
export type ConnectionKind = "appliance" | "customer" | "agreement" | "purchase" | "seller" | "visit" | "invoice";
export type RelatedLink = { group: string; text: string; href: string };
export type HistoryLine = { id: string; at: Date; who: string; what: string; detail: string | null };
export type RecordConnections = { related: RelatedLink[]; history: HistoryLine[] };

const ENTITY: Record<ConnectionKind, string> = {
  appliance: "Appliance", customer: "Customer", agreement: "RentalAgreement", purchase: "Purchase",
  seller: "Supplier", visit: "Job", invoice: "Invoice",
};
const HISTORY_LIMIT = 30;
const GROUP_LIMIT = 6;

const WORDS: Record<string, string> = {
  "appliance.unit.status": "Status changed",
  "appliance.repair_visit_drafted": "Repair visit drafted after a failed inspection",
  "appliance.inspection": "Inspection recorded",
};

/** Turns a stored action code into a short plain phrase; never shows the raw code. */
export function plainAction(action: string): string {
  const known = WORDS[action];
  if (known) return known;
  const parts = action.split(".");
  const tail = (parts.length > 1 ? parts.slice(1).join(" ") : parts[0]).replace(/[_-]+/g, " ").trim();
  const text = tail.length ? tail : "Updated";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detailOf(newValue: unknown): string | null {
  if (!newValue || typeof newValue !== "object") return null;
  const v = newValue as Record<string, unknown>;
  for (const key of ["reason", "note", "summary"]) {
    if (typeof v[key] === "string" && (v[key] as string).trim()) return (v[key] as string).slice(0, 200);
  }
  return null;
}

async function history(kind: ConnectionKind, id: string): Promise<HistoryLine[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: ENTITY[kind], entityId: id },
    select: { id: true, action: true, newValue: true, createdAt: true, user: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: HISTORY_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id, at: r.createdAt, who: r.user ? r.user.name ?? r.user.email : "The system",
    what: plainAction(r.action), detail: detailOf(r.newValue),
  }));
}

const when = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: "America/Denver" }) : "not scheduled yet");
const personOf = (c: { companyName: string | null; user: { name: string | null; email: string } }) => c.companyName ?? c.user.name ?? c.user.email;
const customerSel = { id: true, companyName: true, user: { select: { name: true, email: true } } } as const;
const VISIT_WORD: Record<string, string> = { DELIVERY: "Delivery", INSTALLATION: "Installation", SWAP: "Swap", MAINTENANCE_VISIT: "Repair visit", REMOVAL: "Pickup" };
const applianceSel = { id: true, assetNumber: true, applianceType: { select: { name: true } } } as const;
const applianceText = (a: { assetNumber: string; applianceType: { name: string } }) => a.applianceType.name + " " + a.assetNumber;

const L = (group: string, text: string, href: string): RelatedLink => ({ group, text, href });
const customerLink = (c: Parameters<typeof personOf>[0] & { id: string }) => L("Customer", personOf(c), "/desk/customers/" + c.id);
const agreementLink = (a: { id: string; status: string }) => L("Rental agreement", "Agreement (" + a.status.toLowerCase().replace(/_/g, " ") + ")", "/desk/agreements/" + a.id);
const visitLink = (j: { id: string; type: string; scheduledAt: Date | null }) => L("Visits", (VISIT_WORD[j.type] ?? "Visit") + " — " + when(j.scheduledAt), "/desk/jobs/" + j.id);
const invoiceLink = (i: { id: string; invoiceNumber: number; customerId: string; status: string }) =>
  L("Invoices", "Invoice #" + i.invoiceNumber + " (" + i.status.toLowerCase().replace(/_/g, " ") + ")", "/desk/billing/customer/" + i.customerId + "/invoice/" + i.id);
const applianceLink = (a: Parameters<typeof applianceText>[0] & { id: string }, group = "Appliances") => L(group, applianceText(a), "/desk/inventory/" + a.id);

async function related(kind: ConnectionKind, id: string): Promise<RelatedLink[]> {
  const out: RelatedLink[] = [];
  const visitSel = { id: true, type: true, scheduledAt: true } as const;
  const invoiceSel = { id: true, invoiceNumber: true, customerId: true, status: true } as const;
  const openAssign = { unassignedAt: null } as const;
  if (kind === "appliance") {
    const a = await prisma.appliance.findUnique({
      where: { id },
      select: {
        purchase: { select: { id: true, reference: true, sellerName: true, supplier: { select: { id: true, name: true } } } },
        assignments: { where: openAssign, take: 1, select: { rentalLine: { select: { agreement: { select: { id: true, status: true, customer: { select: customerSel } } } } } } },
        jobs: { take: GROUP_LIMIT, orderBy: { job: { createdAt: "desc" } }, select: { job: { select: visitSel } } },
      },
    });
    if (!a) return out;
    const ag = a.assignments[0]?.rentalLine.agreement;
    if (ag) { out.push(customerLink(ag.customer), agreementLink(ag)); }
    if (a.purchase) {
      out.push(L("Purchase", "Purchase " + (a.purchase.reference ? "receipt " + a.purchase.reference : "record"), "/desk/purchases/" + a.purchase.id));
      if (a.purchase.supplier) out.push(L("Seller", a.purchase.supplier.name, "/desk/suppliers/" + a.purchase.supplier.id));
    }
    out.push(...a.jobs.map((j) => visitLink(j.job)));
  } else if (kind === "customer") {
    const c = await prisma.customer.findUnique({
      where: { id },
      select: {
        rentalAgreements: { take: GROUP_LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, status: true } },
        invoices: { take: GROUP_LIMIT, orderBy: { createdAt: "desc" }, select: invoiceSel },
        jobs: { take: GROUP_LIMIT, orderBy: { createdAt: "desc" }, select: visitSel },
      },
    });
    if (!c) return out;
    const assigned = await prisma.applianceAssignment.findMany({
      where: { ...openAssign, rentalLine: { agreement: { customerId: id } } }, take: GROUP_LIMIT,
      select: { appliance: { select: applianceSel } }, orderBy: { assignedAt: "desc" },
    });
    out.push(...c.rentalAgreements.map(agreementLink), ...assigned.map((x) => applianceLink(x.appliance, "Appliances now rented")), ...c.invoices.map(invoiceLink), ...c.jobs.map(visitLink));
  } else if (kind === "agreement") {
    const g = await prisma.rentalAgreement.findUnique({
      where: { id },
      select: {
        customer: { select: customerSel },
        invoices: { take: GROUP_LIMIT, orderBy: { createdAt: "desc" }, select: invoiceSel },
        lines: { select: { assignments: { where: openAssign, select: { appliance: { select: applianceSel } } } } },
      },
    });
    if (!g) return out;
    const jobs = await prisma.job.findMany({ where: { agreementId: id }, take: GROUP_LIMIT, orderBy: { createdAt: "desc" }, select: visitSel });
    out.push(customerLink(g.customer), ...g.lines.flatMap((l) => l.assignments).slice(0, GROUP_LIMIT).map((x) => applianceLink(x.appliance)), ...g.invoices.map(invoiceLink), ...jobs.map(visitLink));
  } else if (kind === "purchase") {
    const p = await prisma.purchase.findUnique({
      where: { id },
      select: { supplier: { select: { id: true, name: true } }, sellerName: true, appliances: { take: 10, orderBy: { createdAt: "desc" }, select: applianceSel } },
    });
    if (!p) return out;
    if (p.supplier) out.push(L("Seller", p.supplier.name, "/desk/suppliers/" + p.supplier.id));
    out.push(...p.appliances.map((a) => applianceLink(a, "Appliances bought")));
  } else if (kind === "seller") {
    const s = await prisma.supplier.findUnique({
      where: { id },
      select: { purchases: { take: 10, orderBy: { purchasedOn: "desc" }, select: { id: true, reference: true, purchasedOn: true } } },
    });
    if (!s) return out;
    out.push(...s.purchases.map((p) => L("Purchases", "Purchase " + (p.reference ? "receipt " + p.reference + " — " : "— ") + when(p.purchasedOn), "/desk/purchases/" + p.id)));
  } else if (kind === "visit") {
    const j = await prisma.job.findUnique({
      where: { id },
      select: {
        customer: { select: customerSel }, agreement: { select: { id: true, status: true } },
        appliances: { take: GROUP_LIMIT, select: { appliance: { select: applianceSel } } },
      },
    });
    if (!j) return out;
    if (j.customer) out.push(customerLink(j.customer));
    if (j.agreement) out.push(agreementLink(j.agreement));
    out.push(...j.appliances.map((x) => applianceLink(x.appliance)));
  } else {
    const i = await prisma.invoice.findUnique({ where: { id }, select: { customer: { select: customerSel }, agreement: { select: { id: true, status: true } } } });
    if (!i) return out;
    out.push(customerLink(i.customer));
    if (i.agreement) out.push(agreementLink(i.agreement));
  }
  return out;
}

export async function getRecordConnections(kind: ConnectionKind, id: string): Promise<RecordConnections> {
  await requireRole("OWNER", "ADMIN");
  const [rel, hist] = await Promise.all([related(kind, id), history(kind, id)]);
  return { related: rel, history: hist };
}
