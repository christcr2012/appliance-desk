import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// MCP-10a privacy (real disposable Postgres): the export holds the person's reports and the replies they were shown,
// never internal notes; deletion removes the words and pictures (with recovery tombstones) and keeps numbers/dates.
const m = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: vi.fn(async () => ({ sent: true, outcome: "SENT" as const })) }));
vi.mock("@/lib/photo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => ({ token: "private-test-token", storeId: "store_fbtest" }),
}));
vi.mock("@/domains/backup/media-deletion", () => ({
  deletePrivatePhotoWithRecovery: async (sourceUrl: string) => { m.deleted.push(sourceUrl); },
}));
vi.mock("@/lib/session", () => ({
  getServerSession: async () => ({ user: { id: "nobody", role: "CUSTOMER", archivedAt: null } }),
  requireRole: async () => { throw new Error("not used"); },
}));

import { prisma } from "@/lib/prisma";
import { buildPrivacyExport, fulfillPrivacyDeletion } from "@/domains/privacy";
import { feedbackAttachmentForViewer } from "@/domains/feedback";

const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) && databaseUrl.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("app feedback privacy export and deletion (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const owner = `fbp-owner-${tag}`;
  const user = `fbp-user-${tag}`;
  const customer = `fbp-customer-${tag}`;
  const exportRequest = `fbp-export-${tag}`;
  const deleteRequest = `fbp-delete-${tag}`;
  let reportId = "";
  let reportNumber = 0;
  let attachmentId = "";

  beforeAll(async () => {
    await prisma.user.createMany({ data: [
      { id: owner, email: `${owner}@example.test`, name: "Chris Owner", role: "OWNER" },
      { id: user, email: `${user}@example.test`, name: `Pat Private ${tag}`, role: "CUSTOMER" },
    ] });
    await prisma.customer.create({ data: { id: customer, userId: user, referralCode: `FBP${tag.slice(0, 10)}` } });
    const report = await prisma.feedbackReport.create({
      data: {
        reporterUserId: user, reporterRole: "CUSTOMER", kind: "BUG", title: `My phone number is in here ${tag}`,
        description: `Secret details ${tag}`, expected: `Expected ${tag}`, steps: `Steps ${tag}`,
        routeTemplate: "/account", safeContext: { language: "en", browser: "chrome", device: "phone" },
        requestKey: `fbp-${tag}`, state: "NEEDS_INFORMATION",
      },
    });
    reportId = report.id;
    reportNumber = report.number;
    await prisma.feedbackEntry.createMany({ data: [
      { reportId, authorUserId: owner, visibility: "REPORTER", body: `Visible reply ${tag}` },
      { reportId, authorUserId: owner, visibility: "INTERNAL", body: `Internal note ${tag}` },
      { reportId, authorUserId: user, visibility: "REPORTER", body: `My answer ${tag}` },
    ] });
    const attachment = await prisma.feedbackAttachment.create({
      data: { reportId, uploaderId: user, pathname: `feedback/${reportId}/fa${tag}.webp`, sizeBytes: 10, sha256: "a".repeat(64), width: 1, height: 1 },
    });
    attachmentId = attachment.id;
    await prisma.privacyRequest.createMany({ data: [
      { id: exportRequest, kind: "EXPORT", status: "VERIFIED", customerId: customer, requesterEmail: `${user}@example.test`, verifiedAt: new Date() },
      { id: deleteRequest, kind: "DELETE", status: "VERIFIED", customerId: customer, requesterEmail: `${user}@example.test`, verifiedAt: new Date() },
    ] });
  });

  afterAll(async () => {
    await prisma.feedbackReport.deleteMany({ where: { reporterUserId: user } });
    await prisma.auditLog.deleteMany({ where: { userId: owner } });
    await prisma.privacyRequest.deleteMany({ where: { customerId: customer } });
    await prisma.customer.deleteMany({ where: { id: customer } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, user] } } });
  });

  it("exports the reports, the person's own words and the replies they saw — never internal notes", async () => {
    const json = JSON.parse((await buildPrivacyExport(owner, exportRequest)).toString("utf8"));
    const text = JSON.stringify(json.appFeedback);
    expect(json.appFeedback).toHaveLength(1);
    expect(text).toContain(`Secret details ${tag}`);
    expect(text).toContain(`Visible reply ${tag}`);
    expect(text).toContain(`My answer ${tag}`);
    expect(text).toContain(`fa${tag}.webp`);
    expect(text).not.toContain(`Internal note ${tag}`);
  });

  it("deletion removes the words and pictures, keeps the number, state and dates, and nothing shows content afterwards", async () => {
    const before = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId } });
    const result = await fulfillPrivacyDeletion(owner, deleteRequest, "DELETE");
    expect(result.pseudonymized).toEqual(expect.arrayContaining(["FeedbackReport", "FeedbackEntry", "FeedbackAttachment"]));
    expect(m.deleted).toContain(`https://fbtest.private.blob.vercel-storage.com/feedback/${reportId}/fa${tag}.webp`);

    const after = await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(after).toMatchObject({
      number: reportNumber, state: before.state, title: "Removed", description: "Removed at the person's request",
      expected: null, steps: null, awaitingTeam: false,
    });
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.contentRemovedAt).not.toBeNull();
    const entries = await prisma.feedbackEntry.findMany({ where: { reportId }, orderBy: { createdAt: "asc" } });
    expect(entries.find((entry) => entry.authorUserId === user)?.body).toBe("Removed");
    expect((await prisma.feedbackAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).deletedAt).not.toBeNull();
    expect(await prisma.feedbackEvent.count({ where: { reportId, action: "CONTENT_REMOVED" } })).toBe(1);
    expect(await feedbackAttachmentForViewer(attachmentId, { id: owner, role: "OWNER" })).toBeNull();
    const everything = JSON.stringify(await prisma.feedbackReport.findUniqueOrThrow({ where: { id: reportId }, include: { entries: { where: { authorUserId: user } }, events: true } }));
    expect(everything).not.toContain(`Secret details ${tag}`);
    expect(everything).not.toContain(`My answer ${tag}`);
    expect(everything).not.toContain(`My phone number is in here ${tag}`);
  });
});
