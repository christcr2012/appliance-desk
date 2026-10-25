import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// MCP-10a on real disposable Postgres: sending, double clicks, rate limit, privacy between people, triage rules,
// concurrency, the To do item, and the picture read route's access rule.
const m = vi.hoisted(() => ({
  actor: { id: "", role: "CUSTOMER" as string },
  put: vi.fn(async (pathname: string) => ({ url: `https://teststore.private.blob.vercel-storage.com/${pathname}`, pathname })),
  del: vi.fn(async () => undefined),
}));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => (m.actor.id ? { user: { id: m.actor.id, role: m.actor.role, archivedAt: null } } : null),
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(m.actor.role)) throw new Error("redirect: role not allowed");
    return { user: { id: m.actor.id, role: m.actor.role } };
  },
  requireSession: async () => ({ user: { id: m.actor.id, role: m.actor.role } }),
}));
vi.mock("@vercel/blob", () => ({ put: m.put, del: m.del, get: vi.fn(), list: vi.fn(async () => ({ blobs: [], hasMore: false })) }));
vi.mock("@/lib/photo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => ({ token: "test-private-token", storeId: "store_teststore" }),
}));

import { prisma } from "@/lib/prisma";
import {
  addFeedbackDetails, addFeedbackScreenshot, addInternalNote, closeMyFeedback, feedbackAttachmentForViewer,
  getFeedbackForTriage, getMyFeedback, listFeedbackForTriage, listMyFeedback, markDuplicate, reopenMyFeedback,
  replyToReporter, setFeedbackState, submitFeedback,
} from "@/domains/feedback";
import { listFeedbackWaiting } from "@/domains/exceptions/feedback-attention";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && !process.env.VERCEL && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("app feedback with real disposable Postgres", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const ids = {
    owner: `fb-owner-${tag}`, admin: `fb-admin-${tag}`, staff: `fb-staff-${tag}`,
    customerA: `fb-cust-a-${tag}`, customerB: `fb-cust-b-${tag}`, gone: `fb-gone-${tag}`,
  };
  const as = (id: string, role: string) => { m.actor = { id, role }; };
  let n = 0;
  const report = (extra: Partial<Parameters<typeof submitFeedback>[0]> = {}) =>
    submitFeedback({
      kind: "BUG", title: `Save button ${tag} ${++n}`, description: "Tapping Save does nothing at all.",
      path: "/account/rentals/cmh3k2l9x0000abcdefghijk?secret=1", requestKey: randomUUID(), ...extra,
    }, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", language: "en" });
  const versionOf = async (id: string) => (await prisma.feedbackReport.findUniqueOrThrow({ where: { id } })).version;

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: ids.owner, email: `${ids.owner}@example.test`, name: "Chris Owner", role: "OWNER" },
      { id: ids.admin, email: `${ids.admin}@example.test`, name: "Ada Admin", role: "ADMIN" },
      { id: ids.staff, email: `${ids.staff}@example.test`, name: "Sam Staff", role: "STAFF" },
      { id: ids.customerA, email: `${ids.customerA}@example.test`, name: "Alex Customer", role: "CUSTOMER" },
      { id: ids.customerB, email: `${ids.customerB}@example.test`, name: "Bea Customer", role: "CUSTOMER" },
      { id: ids.gone, email: `${ids.gone}@example.test`, role: "CUSTOMER", archivedAt: new Date() },
    ] });
  });
  // Each test starts with a fresh hourly allowance for these synthetic people only (never other rows).
  const rateRows = () => Object.values(ids).flatMap((id) => ["feedback:", "feedback-upload:"].map((prefix) =>
    "rate-limit:" + createHash("sha256").update(prefix + id).digest("hex")));
  beforeEach(async () => {
    m.put.mockClear();
    m.del.mockClear();
    await prisma.verification.deleteMany({ where: { identifier: { in: rateRows() } } });
  });
  afterAll(async () => {
    const users = Object.values(ids);
    await prisma.feedbackReport.updateMany({ where: { reporterUserId: { in: users } }, data: { duplicateOfId: null } });
    await prisma.feedbackReport.deleteMany({ where: { reporterUserId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.verification.deleteMany({ where: { identifier: { in: rateRows() } } });
  });

  it("a customer sends a report; only the page's shape and coarse context are kept; it starts HUMAN_ONLY", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    const row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row).toMatchObject({
      reporterUserId: ids.customerA, reporterRole: "CUSTOMER", state: "SUBMITTED", aiReview: "HUMAN_ONLY",
      awaitingTeam: true, routeTemplate: "/account/rentals/[id]", version: 1,
    });
    expect(row.safeContext).toEqual({ language: "en", browser: "safari", device: "phone" });
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(await prisma.feedbackEvent.count({ where: { reportId: sent.id, action: "SUBMITTED" } })).toBe(1);
    const mine = await listMyFeedback();
    expect(mine.rows.map((r) => r.id)).toContain(sent.id);
  });

  it("a double click (the same request key twice, even at once) makes one report", async () => {
    as(ids.customerA, "CUSTOMER");
    const requestKey = randomUUID();
    const [a, b] = await Promise.all([report({ requestKey }), report({ requestKey })]);
    expect(a.id).toBe(b.id);
    expect(await prisma.feedbackReport.count({ where: { reporterUserId: ids.customerA, requestKey } })).toBe(1);
    expect((await report({ requestKey })).id).toBe(a.id);
  });

  it("limits each person to five reports an hour", async () => {
    as(ids.customerB, "CUSTOMER");
    for (let i = 0; i < 5; i += 1) await report();
    await expect(report()).rejects.toThrow(/several reports in the last hour/);
    as(ids.staff, "STAFF");
    await expect(report()).resolves.toBeTruthy();
  });

  it("refuses a deactivated account and someone not signed in", async () => {
    as(ids.gone, "CUSTOMER");
    await expect(report()).rejects.toThrow(/sign in again/);
    as("", "CUSTOMER");
    await expect(report()).rejects.toThrow(/sign in again/);
  });

  it("customer B and staff can't list, open, add to, close, reopen or see pictures of customer A's report", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#09f" } }).png().toBuffer();
    const saved = await addFeedbackScreenshot(sent.id, new Blob([new Uint8Array(png)], { type: "image/jpeg" }));
    expect(saved.status).toBe("saved");
    const attachmentId = saved.status === "saved" ? saved.id : "";
    expect(await feedbackAttachmentForViewer(attachmentId, { id: ids.customerA, role: "CUSTOMER" })).toMatch(/^feedback\//);
    for (const [id, role] of [[ids.customerB, "CUSTOMER"], [ids.staff, "STAFF"]] as const) {
      as(id, role);
      expect((await listMyFeedback()).rows.map((r) => r.id)).not.toContain(sent.id);
      await expect(getMyFeedback(sent.id)).rejects.toThrow("Not found");
      await expect(getMyFeedback("does-not-exist")).rejects.toThrow("Not found");
      await expect(addFeedbackDetails(sent.id, 1, "Let me in")).rejects.toThrow("Not found");
      await expect(closeMyFeedback(sent.id, 1)).rejects.toThrow("Not found");
      await expect(reopenMyFeedback(sent.id, 1, "Let me in")).rejects.toThrow("Not found");
      await expect(addFeedbackScreenshot(sent.id, new Blob([new Uint8Array(png)]))).rejects.toThrow("Not found");
      expect(await feedbackAttachmentForViewer(attachmentId, { id, role })).toBeNull();
      await expect(listFeedbackForTriage()).rejects.toThrow(/role not allowed/);
      await expect(getFeedbackForTriage(sent.id)).rejects.toThrow(/role not allowed/);
      await expect(replyToReporter(sent.id, 1, "hi")).rejects.toThrow(/role not allowed/);
    }
    expect(await feedbackAttachmentForViewer(attachmentId, { id: ids.owner, role: "OWNER" })).toMatch(/^feedback\//);
    expect(await feedbackAttachmentForViewer(attachmentId, { id: ids.admin, role: "ADMIN" })).toMatch(/^feedback\//);
  });

  it("staff see their own report as a reporter", async () => {
    as(ids.staff, "STAFF");
    const sent = await report({ kind: "IMPROVEMENT", title: `Staff idea ${tag}` });
    const mine = await getMyFeedback(sent.id);
    expect(mine.title).toBe(`Staff idea ${tag}`);
    expect(mine.expected).toBeNull();
  });

  it("pictures: count limit, stored as private WebP, and a failed database write removes the stored file", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#f90" } }).png().toBuffer();
    await expect(addFeedbackScreenshot(sent.id, new Blob([Buffer.from("<svg></svg>")]))).rejects.toThrow(/PNG, JPEG or WebP/);
    expect(m.put).not.toHaveBeenCalled();

    // The upload rate check runs its own transaction first; the second one (saving the picture row) fails.
    const realTransaction = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
    let transactions = 0;
    const failure = vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
      transactions += 1;
      return transactions === 2 ? Promise.reject(new Error("database unavailable")) : realTransaction(...args);
    }) as never);
    await expect(addFeedbackScreenshot(sent.id, new Blob([new Uint8Array(png)]))).rejects.toThrow(/database unavailable/);
    failure.mockRestore();
    const orphan = (m.put.mock.results[0]!.value as Promise<{ url: string }>);
    expect(m.del).toHaveBeenCalledWith((await orphan).url, { token: "test-private-token" });
    expect(await prisma.feedbackAttachment.count({ where: { reportId: sent.id } })).toBe(0);

    for (let i = 0; i < 3; i += 1) expect((await addFeedbackScreenshot(sent.id, new Blob([new Uint8Array(png)]))).status).toBe("saved");
    await expect(addFeedbackScreenshot(sent.id, new Blob([new Uint8Array(png)]))).rejects.toThrow(/up to 3 pictures/);
    const call = m.put.mock.calls[1] as unknown as [string, Buffer, Record<string, unknown>];
    expect(call[0]).toMatch(new RegExp(`^feedback/${sent.id}/fa[a-f0-9]+\\.webp$`));
    expect(call[2]).toMatchObject({ access: "private", contentType: "image/webp", addRandomSuffix: false });
    const stored = await prisma.feedbackAttachment.findFirstOrThrow({ where: { reportId: sent.id } });
    expect(stored).toMatchObject({ uploaderId: ids.customerA, width: 30, height: 20 });
  });

  it("triage: allowed changes only, reasons required, internal notes stay internal, awaitingTeam flips", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    as(ids.owner, "OWNER");
    await expect(setFeedbackState(sent.id, 1, "IN_PROGRESS", "")).rejects.toThrow(/isn't allowed/);
    await expect(setFeedbackState(sent.id, 1, "DECLINED", "")).rejects.toThrow(/reason/);
    await replyToReporter(sent.id, 1, "Which page were you on?", "NEEDS_INFORMATION");
    await addInternalNote(sent.id, `Internal only ${tag}`);
    let row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row).toMatchObject({ state: "NEEDS_INFORMATION", awaitingTeam: false, version: 2 });
    expect((await listFeedbackWaiting(50)).rows.some((item) => item.href === `/desk/feedback/${sent.id}`)).toBe(false);

    as(ids.customerA, "CUSTOMER");
    const mine = await getMyFeedback(sent.id);
    expect(mine.state).toBe("NEEDS_INFORMATION");
    expect(JSON.stringify(mine)).not.toContain(`Internal only ${tag}`);
    expect(mine.entries[0]).toMatchObject({ who: "Chris at Robinson Appliance Rentals", mine: false });
    await addFeedbackDetails(sent.id, mine.version, "The rentals page.");
    row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row).toMatchObject({ state: "TRIAGED", awaitingTeam: true });

    as(ids.admin, "ADMIN");
    const todo = await listFeedbackWaiting(50);
    const item = todo.rows.find((entry) => entry.href === `/desk/feedback/${sent.id}`);
    expect(item).toMatchObject({ category: "FEEDBACK_WAITING", detail: "They answered", severity: "medium" });
    expect(item?.title).toMatch(/^App feedback #\d+: /);
    const answered = await listFeedbackForTriage({ tab: "answered" });
    expect(answered.rows.map((r) => r.id)).toContain(sent.id);
    expect(answered.counts.answered).toBeGreaterThanOrEqual(1);

    await setFeedbackState(sent.id, row.version, "ACCEPTED", "");
    await setFeedbackState(sent.id, row.version + 1, "IN_PROGRESS", "");
    await setFeedbackState(sent.id, row.version + 2, "AWAITING_VERIFICATION", "");
    await expect(setFeedbackState(sent.id, row.version + 3, "RESOLVED", "ok")).rejects.toThrow(/reason/);
    await setFeedbackState(sent.id, row.version + 3, "RESOLVED", "Fixed the Save button");
    row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row.state).toBe("RESOLVED");
    expect(row.closedAt).not.toBeNull();
    expect((await listFeedbackWaiting(50)).rows.some((entry) => entry.href === `/desk/feedback/${sent.id}`)).toBe(false);
    const detail = await getFeedbackForTriage(sent.id);
    expect(detail.entries.some((entry) => entry.visibility === "INTERNAL")).toBe(true);
    expect(detail.events.find((event) => event.toState === "RESOLVED")?.reason).toBe("Fixed the Save button");
    await expect(setFeedbackState(sent.id, row.version, "TRIAGED", "")).rejects.toThrow(/isn't allowed/);
  });

  it("reopen works only within the reopen window", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    await closeMyFeedback(sent.id, 1);
    await reopenMyFeedback(sent.id, 2, "Still broken today");
    let row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    expect(row).toMatchObject({ state: "TRIAGED", awaitingTeam: true, closedAt: null });
    await closeMyFeedback(sent.id, row.version);
    await prisma.feedbackReport.update({ where: { id: sent.id }, data: { closedAt: new Date(Date.now() - 91 * 86_400_000) } });
    row = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: sent.id } });
    await expect(reopenMyFeedback(sent.id, row.version, "Still broken")).rejects.toThrow(/can be reopened for 90 days/);
  });

  it("two people replying at once: one wins, the other is told it changed", async () => {
    as(ids.customerA, "CUSTOMER");
    const sent = await report();
    as(ids.owner, "OWNER");
    const results = await Promise.allSettled([
      replyToReporter(sent.id, 1, "Reply one"),
      replyToReporter(sent.id, 1, "Reply two"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason)).toMatch(/changed since you opened it/);
    expect(await versionOf(sent.id)).toBe(2);
    expect(await prisma.feedbackEntry.count({ where: { reportId: sent.id } })).toBe(1);
  });

  it("marking as already reported links privately; the reporter sees only Already reported", async () => {
    as(ids.customerA, "CUSTOMER");
    const first = await report();
    as(ids.customerB, "CUSTOMER");
    const copy = await report();
    as(ids.owner, "OWNER");
    await expect(markDuplicate(copy.id, 1, copy.number)).rejects.toThrow(/copy of itself/);
    await markDuplicate(copy.id, 1, first.number);
    expect(await prisma.feedbackReport.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({ state: "DUPLICATE", duplicateOfId: first.id });
    as(ids.customerB, "CUSTOMER");
    const mine = await getMyFeedback(copy.id);
    expect(mine.state).toBe("DUPLICATE");
    expect(JSON.stringify(mine)).not.toContain(first.id);
    expect(JSON.stringify(mine)).not.toContain(`#${first.number}`);
    await expect(getMyFeedback(first.id)).rejects.toThrow("Not found");
  });
});
