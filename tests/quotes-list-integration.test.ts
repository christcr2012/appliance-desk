import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...orig,
    requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
  };
});

import { getQuoteCounts, getQuotes } from "@/domains/estimates";
import { prisma } from "@/lib/prisma";

let enabled = false;
try {
  const t = new URL(process.env.DATABASE_URL ?? "");
  enabled =
    process.env.CI === "true" &&
    ["localhost", "127.0.0.1"].includes(t.hostname) &&
    t.pathname === "/appliance_desk_test";
} catch {
  enabled = false;
}

// AR-4d / QUOTES-MESSAGES spec sections 2 + 4: the paged quotes read — tabs,
// money sums (price × quantity, the domain's own totals math), search by
// name/company/quote number, the customer/lead split, and cursor walks that
// return every row exactly once for every sort.
describe.skipIf(!enabled)("quotes list (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerId = `qt-owner-${tag}`;
  const custUserId = `qt-cust-user-${tag}`;
  const customerId = `qt-customer-${tag}`;
  const leadId = `qt-lead-${tag}`;
  const ids: string[] = [];
  const byKey = new Map<string, string>();
  const day = 86_400_000;
  const ago = (n: number) => new Date(Date.now() - n * day);
  const ahead = (n: number) => new Date(Date.now() + n * day);

  async function quote(
    key: string,
    data: Omit<
      import("@prisma/client").Prisma.EstimateUncheckedCreateInput,
      "title" | "createdByUserId"
    >,
    lines: Array<{ monthlyPriceCents: number; oneTimeFeeCents: number; quantity: number }> = [],
  ) {
    const row = await prisma.estimate.create({
      data: { title: `QT ${key}`, createdByUserId: ownerId, ...data },
    });
    ids.push(row.id);
    byKey.set(key, row.id);
    if (lines.length) {
      await prisma.estimateLineItem.createMany({
        data: lines.map((l) => ({ estimateId: row.id, description: "line", ...l })),
      });
    }
    return row;
  }

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: ownerId, email: `qt-owner-${tag}@example.test`, name: "QT Owner", role: "OWNER" },
    });
    await prisma.user.create({
      data: { id: custUserId, email: `qt-sue-${tag}@example.test`, name: "QT Sue", role: "CUSTOMER" },
    });
    await prisma.customer.create({
      data: { id: customerId, userId: custUserId, companyName: "Sue Props LLC", referralCode: `QT${tag}` },
    });
    await prisma.lead.create({
      data: { id: leadId, contactName: "QT Larry", companyName: "Larry Holdings", phone: "9705550100" },
    });

    await quote("draftCust", { customerId, status: "DRAFT", createdAt: ago(1) }, [
      { monthlyPriceCents: 10_000, oneTimeFeeCents: 5_000, quantity: 2 },
      { monthlyPriceCents: 0, oneTimeFeeCents: 1_500, quantity: 1 },
    ]);
    await quote("sentCust", {
      customerId, status: "SENT", sentAt: ago(10), validUntil: ahead(2), createdAt: ago(9),
    }, [{ monthlyPriceCents: 15_000, oneTimeFeeCents: 0, quantity: 1 }]);
    await quote("viewedLead", { leadId, status: "VIEWED", sentAt: ago(5), viewedAt: ago(4), createdAt: ago(6) });
    await quote("changesCust", { customerId, status: "CHANGES_REQUESTED", sentAt: ago(3), createdAt: ago(3) });
    await quote("draftLead", { leadId, status: "DRAFT", createdAt: ago(2) });
    await quote("approvedCust", { customerId, status: "APPROVED", sentAt: ago(7), createdAt: ago(7) });
    await quote("wonBoth", { customerId, leadId, status: "CONVERTED", sentAt: ago(20), createdAt: ago(20) });
    await quote("declinedLead", { leadId, status: "DECLINED", sentAt: ago(8), createdAt: ago(8) });
    await quote("expiredCust", { customerId, status: "EXPIRED", sentAt: ago(30), validUntil: ago(1), createdAt: ago(30) });
  });

  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: { in: ids } } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, custUserId] } } });
  });

  const mine = (rows: Array<{ id: string }>) =>
    rows.map((r) => r.id).filter((id) => ids.includes(id));

  it("open tab holds exactly the open statuses; counts match every tab", async () => {
    const { rows } = await getQuotes({ tab: "open", pageSize: 500 });
    expect(new Set(mine(rows))).toEqual(
      new Set([byKey.get("draftCust"), byKey.get("sentCust"), byKey.get("viewedLead"), byKey.get("changesCust"), byKey.get("draftLead")]),
    );
    const counts = await getQuoteCounts({});
    expect(counts.open).toBeGreaterThanOrEqual(5);
    expect(counts.approved).toBeGreaterThanOrEqual(1);
    expect(counts.won).toBeGreaterThanOrEqual(1);
    expect(counts.closed).toBeGreaterThanOrEqual(2);
    expect(counts.drafts).toBeGreaterThanOrEqual(2);
    const approved = await getQuotes({ tab: "approved", pageSize: 500 });
    expect(mine(approved.rows)).toEqual([byKey.get("approvedCust")]);
    const won = await getQuotes({ tab: "won", pageSize: 500 });
    expect(mine(won.rows)).toEqual([byKey.get("wonBoth")]);
  });

  it("money sums use price × quantity, in one grouped read", async () => {
    const { rows } = await getQuotes({ tab: "drafts", q: "sue", pageSize: 500 });
    const draft = rows.find((r) => r.id === byKey.get("draftCust"));
    expect(draft).toBeTruthy();
    expect(draft!.monthlyCents).toBe(20_000);
    expect(draft!.oneTimeCents).toBe(11_500);
    expect(draft!.customer?.name).toBe("QT Sue");
    expect(draft!.customer?.company).toBe("Sue Props LLC");
  });

  it("search finds by quote number digits and by lead name", async () => {
    const sent = await prisma.estimate.findUniqueOrThrow({ where: { id: byKey.get("sentCust")! } });
    const byNumber = await getQuotes({ tab: "open", q: String(sent.estimateNumber), pageSize: 500 });
    expect(mine(byNumber.rows)).toEqual([sent.id]);
    const byName = await getQuotes({ tab: "open", q: "larry", pageSize: 500 });
    expect(new Set(mine(byName.rows))).toEqual(new Set([byKey.get("viewedLead"), byKey.get("draftLead")]));
  });

  it("who splits leads from customers; a converted lead quote counts as a customer", async () => {
    const leads = await getQuotes({ tab: "open", who: "leads", pageSize: 500 });
    expect(new Set(mine(leads.rows))).toEqual(new Set([byKey.get("viewedLead"), byKey.get("draftLead")]));
    const won = await getQuotes({ tab: "won", who: "customers", pageSize: 500 });
    expect(mine(won.rows)).toEqual([byKey.get("wonBoth")]);
    const wonLeads = await getQuotes({ tab: "won", who: "leads", pageSize: 500 });
    expect(mine(wonLeads.rows)).toEqual([]);
  });

  it.each(["newest", "oldest-sent", "value-desc", "expires"] as const)(
    "cursor walk grows the window to every open row exactly once (%s)",
    async (sort) => {
      // KIT 5.1 windows grow from the start (the client replaces, not
      // appends): each page must extend the previous one, and the final
      // window holds every fixture row exactly once.
      let previous: string[] = [];
      let cursor: string | undefined;
      let finalRows: string[] = [];
      for (let i = 0; i < 6; i++) {
        const page = await getQuotes({ tab: "open", sort, cursor, pageSize: 2 });
        const current = mine(page.rows);
        expect(current.slice(0, previous.length)).toEqual(previous);
        expect(new Set(current).size).toBe(current.length);
        previous = current;
        finalRows = current;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(new Set(finalRows)).toEqual(
        new Set([byKey.get("draftCust"), byKey.get("sentCust"), byKey.get("viewedLead"), byKey.get("changesCust"), byKey.get("draftLead")]),
      );
    },
  );

  it("oldest-sent puts the longest-waiting first and drafts last", async () => {
    const { rows } = await getQuotes({ tab: "open", sort: "oldest-sent", pageSize: 500 });
    const order = mine(rows);
    expect(order[0]).toBe(byKey.get("sentCust"));
    expect(new Set(order.slice(-2))).toEqual(new Set([byKey.get("draftCust"), byKey.get("draftLead")]));
  });
});
