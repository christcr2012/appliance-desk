import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Blob storage is an in-memory stand-in (the privacy store is not reachable from tests);
// everything else — database, files, encryption — is real. Same pattern as the VAULT-1 tests.
const m = vi.hoisted(() => ({
  blobs: new Map<string, Uint8Array>(),
  store: { token: "test-token", storeId: "store_test" } as { token: string; storeId: string } | null,
}));
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string, body: Buffer | Uint8Array) => {
    m.blobs.set(pathname, new Uint8Array(body as Uint8Array));
    return { url: `https://store.example/${pathname}`, pathname };
  },
  get: async (pathname: string) => {
    const bytes = m.blobs.get(pathname);
    if (!bytes) return { statusCode: 404, stream: null, blob: { contentType: "", size: 0 } };
    return {
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      blob: { contentType: "application/pdf", size: bytes.length },
    };
  },
  del: async () => undefined,
  list: async () => ({ blobs: [], hasMore: false }),
}));
vi.mock("@/lib/photo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/photo-storage")>()),
  getPrivatePhotoStore: () => m.store,
}));
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  acceptInvitation, inviteTeamMember, removeTeamMember, restoreTeamMember, setAccountantAccessEndDate,
} from "@/domains/team";
import { hashInvitationCode } from "@/domains/team/rules";
import { endOfDenverDayKey } from "@/domains/accountant/rules";
import {
  listAccountantChanges, markAccountantChangesSeen, revokeEndedAccountantSessions, unseenAccountantChangeCount,
} from "@/domains/accountant";
import { listAccountantAttention } from "@/domains/accountant/attention";
import {
  addCustomAccount, exportMonthReview, getBooksWorkspace, initializeBooks, renameAccount,
} from "@/domains/books/management";
import { createAdjustingEntry, reverseAdjustingEntry } from "@/domains/books/adjustments";
import { approveFiling, markFilingReviewed, prepareFiling, submitFiling } from "@/domains/compliance/filings";
import { getDecision, listDecisions, recordProfessionalAnswer } from "@/domains/decisions";
import { createPaperwork } from "@/domains/paperwork";
import { getSecondStepView } from "@/domains/security/second-step";
import { getMyAccount } from "@/domains/account";
import type { PaperworkInput } from "@/domains/paperwork/schema";
import {
  attachRecordFile, getRecord, listRecords, setRecordSharedWithAccountant,
} from "@/domains/paperwork/records";
import { canUploadPhoto } from "@/domains/uploads";
import { listCredentials } from "@/domains/vault";
import { businessDateKey } from "@/lib/business-date";

// ACCT-1 on real Postgres: the accountant level end to end — invite and accept carry the firm and
// the end date; the books allowlist holds (adjustments yes, everything else no); compliance
// prepare/review yes, approve/submit no; decisions answers are CPA-only with the accountant's own
// name/firm stamped; paperwork is shared-only; the vault refuses; the owner manages the end date
// and removal; the expiry sweep signs an ended accountant out. Writes the shared settings row
// (the seen marker, and the books start date when the seed has none), so it runs in the serial
// shared-settings project and restores what it changed.
const target = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  !!target &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";
const PASSWORD = "Acct1-Test-Password-2026!";
const CPA_SUBJECT = "IN-37-RDF-OWED";
const OWNER_SUBJECT = "LATE-FEE-AMOUNT";

describe.skipIf(!enabled)("ACCT-1 accountant access on real Postgres", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: `acct1-owner-${tag}`,
    admin: `acct1-admin-${tag}`,
    staff: `acct1-staff-${tag}`,
  };
  const acctEmail = `${tag}-cpa@example.test`;
  let accountantId = "";
  let accountA = "";
  let accountB = "";
  let booksMonth = "2025-03";
  let booksDate = "2025-03-31";
  let adjustmentId = "";
  let filingId = "";
  let sharedRecordId = "";
  let unsharedRecordId = "";
  let settingsBefore: { accountantChangesSeenAt: Date | null; booksStartDate: Date | null } | null = null;
  const createdEntryIds: string[] = [];

  async function knownCode(invitationId: string) {
    const code = `known-${randomUUID()}-${randomUUID()}`;
    await prisma.teamInvitation.update({ where: { id: invitationId }, data: { codeHash: hashInvitationCode(code) } });
    return code;
  }

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { accountantChangesSeenAt: true, booksStartDate: true },
    });
    settingsBefore = settings;
    await prisma.user.create({ data: { id: ids.owner, name: "Owner", email: `${tag}-owner@example.test`, role: "OWNER", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.admin, name: "Admin", email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true } });
    await prisma.user.create({ data: { id: ids.staff, name: "Staff", email: `${tag}-staff@example.test`, role: "STAFF", emailVerified: true } });
    // Books fixtures: initialize only when the database has no chart yet (the seed normally does).
    const accounts = await prisma.ledgerAccount.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
    if (accounts.length < 2) {
      await initializeBooks({ id: ids.owner, role: "OWNER" }, { startDate: "2025-01-01", bankCents: 0, stripeCents: 0, cardCents: 0 });
    }
    const ready = await prisma.ledgerAccount.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } });
    accountA = ready[0]!.id;
    accountB = ready[1]!.id;
    // Guarantee a books start date (restored in afterAll from the snapshot).
    const after = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { booksStartDate: true } });
    if (!after.booksStartDate) {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { booksStartDate: new Date("2025-01-01T07:00:00Z") } });
    }
    const start = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { booksStartDate: true } });
    const startKey = businessDateKey(start.booksStartDate!);
    const [y, m] = startKey.split("-").map(Number);
    const next = new Date(Date.UTC(y!, m!, 15)); // the 15th of the month after the books start
    booksMonth = next.toISOString().slice(0, 7);
    booksDate = next.toISOString().slice(0, 10);
  });

  afterAll(async () => {
    const mine = await prisma.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const userIds = [...mine.map((u) => u.id), ids.owner, ids.admin, ids.staff];
    // Records first: a leaked record with files breaks the paperwork suite's global cleanup.
    for (const recordId of [sharedRecordId, unsharedRecordId]) {
      if (!recordId) continue;
      await prisma.businessRecordFile.deleteMany({ where: { recordId } }).catch(() => undefined);
      await prisma.businessPaperwork.deleteMany({ where: { id: recordId } }).catch(() => undefined);
    }
    await prisma.decisionRecord.deleteMany({ where: { answeredByUserId: { in: userIds } } }).catch(() => undefined);
    await prisma.decisionScheduledChange.deleteMany({ where: { subjectId: { in: [CPA_SUBJECT, OWNER_SUBJECT] } } }).catch(() => undefined);
    if (filingId) await prisma.complianceFiling.deleteMany({ where: { id: filingId } });
    await prisma.exportBatch.deleteMany({ where: { createdByUserId: { in: userIds } } }).catch(() => undefined);
    if (createdEntryIds.length) {
      await prisma.journalLine.deleteMany({ where: { entryId: { in: createdEntryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
    }
    await prisma.teamInvitation.deleteMany({ where: { email: { startsWith: tag } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { entityId: { in: userIds } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (settingsBefore) {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: settingsBefore });
    }
  });

  it("only the owner invites an accountant; the invite carries firm + end date onto the account", async () => {
    await expect(
      inviteTeamMember(ids.admin, { name: "Casey CPA", email: acctEmail, accessLevel: "ACCOUNTANT", firm: "Casey & Co", accessEndsOn: endOfDenverDayKey("2027-05-01") }),
    ).rejects.toThrow("Only the owner");
    await expect(
      inviteTeamMember(ids.owner, { name: "Casey CPA", email: acctEmail, accessLevel: "ACCOUNTANT", jobRoleId: "anything" }),
    ).rejects.toThrow();
    const invited = await inviteTeamMember(ids.owner, {
      name: "Casey CPA", email: acctEmail, accessLevel: "ACCOUNTANT",
      firm: "Casey & Co", accessEndsOn: endOfDenverDayKey("2027-05-01"),
    });
    const row = await prisma.teamInvitation.findUniqueOrThrow({ where: { id: invited.invitationId } });
    expect(row.firm).toBe("Casey & Co");
    expect(row.accessEndsOn?.toISOString()).toBe(endOfDenverDayKey("2027-05-01").toISOString());
    const code = await knownCode(invited.invitationId);
    await acceptInvitation(code, PASSWORD, PASSWORD);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: acctEmail } });
    accountantId = user.id;
    expect(user.role).toBe("ACCOUNTANT");
    expect(user.firm).toBe("Casey & Co");
    expect(user.accessEndsOn?.toISOString()).toBe(endOfDenverDayKey("2027-05-01").toISOString());
  });

  it("an ended accountant is refused by the actor assertion and swept out of their sessions", async () => {
    await prisma.session.create({ data: { userId: accountantId, token: `acct1-token-${tag}`, expiresAt: new Date(Date.now() + 3600_000) } });
    await prisma.user.update({ where: { id: accountantId }, data: { accessEndsOn: new Date(Date.now() - 60_000) } });
    await expect(
      prisma.$transaction((tx) => assertActiveTeamActor(tx, accountantId, ["ACCOUNTANT"])),
    ).rejects.toThrow();
    const swept = await revokeEndedAccountantSessions();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findFirst({ where: { userId: accountantId } })).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "accountant.access_expired", entityId: accountantId } });
    expect(audit).toBeTruthy();
    await setAccountantAccessEndDate(ids.owner, accountantId, endOfDenverDayKey("2027-05-01"));
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: accountantId } });
    expect(restored.accessEndsOn?.toISOString()).toBe(endOfDenverDayKey("2027-05-01").toISOString());
  });

  it("the accountant works the books allowlist: workspace, export, an adjustment the owner can reverse", async () => {
    const writer = { kind: "person", userId: accountantId } as const;
    const workspace = await getBooksWorkspace({ id: accountantId, role: "ACCOUNTANT" }, {});
    expect(workspace.accounts.length).toBeGreaterThan(0);
    const out = await exportMonthReview({ id: accountantId, role: "ACCOUNTANT" }, booksMonth);
    expect(out.csv).toContain("Date,Entry,Source");
    await expect(
      createAdjustingEntry(writer, {
        dateKey: booksDate, memo: `Year-end fix ${tag}`,
        lines: [
          { accountId: accountA, debitCents: 10000, creditCents: 0 },
          { accountId: accountB, debitCents: 0, creditCents: 10000 },
        ],
      }),
    ).resolves.toBeTruthy();
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "ADJUSTMENT", memo: { contains: tag } },
      select: { id: true, sourceId: true },
    });
    adjustmentId = entry.id;
    createdEntryIds.push(entry.id);
    await expect(
      createAdjustingEntry(writer, {
        dateKey: booksDate, memo: `Unbalanced ${tag}`,
        lines: [
          { accountId: accountA, debitCents: 5000, creditCents: 0 },
          { accountId: accountB, debitCents: 0, creditCents: 4000 },
        ],
      }),
    ).rejects.toThrow();
    await expect(reverseAdjustingEntry(writer, adjustmentId)).rejects.toThrow();
    const reversed = await reverseAdjustingEntry({ kind: "person", userId: ids.owner }, adjustmentId);
    createdEntryIds.push(reversed.reversalId);
    await expect(reverseAdjustingEntry({ kind: "person", userId: ids.owner }, adjustmentId)).rejects.toThrow();
  });

  it("the rest of the books refuses the accountant", async () => {
    const actor = { id: accountantId, role: "ACCOUNTANT" } as const;
    await expect(renameAccount(actor, accountA, "Nope")).rejects.toThrow();
    await expect(addCustomAccount(actor, { name: "Nope", description: "Nope", type: "ASSET", isPaymentSource: false })).rejects.toThrow();
    await expect(initializeBooks(actor, { startDate: "2025-01-01", bankCents: 0, stripeCents: 0, cardCents: 0 })).rejects.toThrow();
  });

  it("the owner's feed shows the accountant's changes until the owner looks", async () => {
    const feed = await listAccountantChanges(ids.owner);
    const mine = feed.filter((row) => row.summary.includes("adjusting entry") || row.summary.includes("Moved"));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0]!.actorName).toBe("Casey CPA");
    expect(await unseenAccountantChangeCount(ids.owner)).toBeGreaterThanOrEqual(1);
    await markAccountantChangesSeen(ids.owner);
    expect(await unseenAccountantChangeCount(ids.owner)).toBe(0);
    const attention = await listAccountantAttention(ids.owner);
    expect(attention.some((item) => item.title.includes("Casey CPA"))).toBe(false); // end date is far away, nothing unseen
    // Bring the end date inside the 14-day warning window: the To do item appears.
    const soon = new Date(Date.now() + 10 * 24 * 3600_000);
    await setAccountantAccessEndDate(ids.owner, accountantId, soon);
    const warned = await listAccountantAttention(ids.owner);
    expect(warned.some((item) => item.title.includes("Casey CPA") && item.title.includes("access ends on"))).toBe(true);
    await setAccountantAccessEndDate(ids.owner, accountantId, endOfDenverDayKey("2027-05-01"));
  });

  it("compliance: the accountant prepares and marks reviewed; only the owner approves and submits", async () => {
    const filing = await prisma.complianceFiling.create({
      data: {
        obligationKey: "fed.estimated_tax", periodKey: "2099-Q1", state: "UPCOMING",
        dueOn: new Date("2099-04-15T00:00:00Z"), actOn: new Date("2099-04-01T00:00:00Z"),
      },
    });
    filingId = filing.id;
    await prepareFiling(accountantId, filingId, { totalCents: 12500, note: `Prepared ${tag}` });
    let row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(row.state).toBe("READY_FOR_REVIEW");
    expect(row.preparedHash).toBeTruthy();
    await markFilingReviewed(accountantId, filingId);
    row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(row.reviewedByUserId).toBe(accountantId);
    expect(row.reviewedAt).toBeTruthy();
    // Preparing fresh figures clears the reviewed mark (the review was of the old numbers).
    await prepareFiling(accountantId, filingId, { totalCents: 13000, note: `Revised ${tag}` });
    row = await prisma.complianceFiling.findUniqueOrThrow({ where: { id: filingId } });
    expect(row.reviewedByUserId).toBeNull();
    expect(row.reviewedAt).toBeNull();
    await expect(approveFiling(accountantId, filingId, row.preparedHash!)).rejects.toThrow();
    await approveFiling(ids.owner, filingId, row.preparedHash!);
    await expect(submitFiling(accountantId, filingId)).rejects.toThrow();
  });

  it("decisions: the accountant answers CPA questions only, stamped with their own name and firm", async () => {
    const cards = await listDecisions(accountantId);
    expect(cards.every((card) => card.audience === "CPA")).toBe(true);
    await expect(getDecision(accountantId, OWNER_SUBJECT)).rejects.toThrow();
    await expect(
      recordProfessionalAnswer(accountantId, OWNER_SUBJECT, {
        value: null, otherText: "Not mine to answer", effectiveFrom: null,
        professionalName: "Forged Name", professionalFirm: "Forged LLC", answeredOn: businessDateKey(new Date()),
      }, "SCREEN"),
    ).rejects.toThrow();
    await recordProfessionalAnswer(accountantId, CPA_SUBJECT, {
      value: null, otherText: `Deferring to next season ${tag}`, effectiveFrom: null,
      professionalName: "Forged Name", professionalFirm: "Forged LLC", answeredOn: businessDateKey(new Date()),
    }, "SCREEN");
    const record = await prisma.decisionRecord.findFirstOrThrow({
      where: { subjectId: CPA_SUBJECT, kind: "PROFESSIONAL_ANSWER", answeredByUserId: accountantId },
    });
    expect(record.professionalName).toBe("Casey CPA");
    expect(record.professionalFirm).toBe("Casey & Co");
  });

  it("paperwork: shared-only, masked, and uploads are stamped as the accountant's", async () => {
    const input = (overrides: Partial<PaperworkInput> = {}): PaperworkInput =>
      ({
        title: `ACCT-1 record ${tag}`, groupName: "Taxes", status: "TO_DO", whatItIs: null, agency: null,
        officialUrl: null, referenceNumber: "CASE-123", startedOn: null, dueOn: null, remindDaysBefore: 30,
        repeatEveryMonths: null, notes: null, kind: "DOCUMENT", issuedOn: null, expiresOn: null,
        numberLabel: null, numberValue: null, portalUrl: null, costDollars: null, linkedObligationKeys: [],
        ...overrides,
      }) as PaperworkInput;
    unsharedRecordId = await createPaperwork(ids.owner, input({ title: `Unshared ${tag}` }));
    sharedRecordId = await createPaperwork(ids.owner, input({ title: `Shared ${tag}` }));
    expect(await getRecord("ACCOUNTANT", unsharedRecordId)).toBeNull();
    expect((await listRecords("ACCOUNTANT")).some((r) => r.id === unsharedRecordId)).toBe(false);
    await setRecordSharedWithAccountant(ids.owner, sharedRecordId, true);
    const view = await getRecord("ACCOUNTANT", sharedRecordId);
    expect(view?.title).toContain("Shared");
    expect(view?.referenceNumber).toBeNull(); // masked: owner-only text never reaches the accountant DTO
    expect(view?.shareWithAccountant).toBe(true);
    const uploadUser = { id: accountantId, role: "ACCOUNTANT", archivedAt: null };
    expect(await canUploadPhoto(uploadUser, `records/${sharedRecordId}/workpaper.pdf`)).toBe(true);
    expect(await canUploadPhoto(uploadUser, `records/${unsharedRecordId}/workpaper.pdf`)).toBe(false);
    await attachRecordFile(accountantId, sharedRecordId, {
      fileName: "workpaper.pdf", bytes: new TextEncoder().encode("%PDF-1.4 test"), label: "2026 workpapers",
    });
    const file = await prisma.businessRecordFile.findFirstOrThrow({ where: { recordId: sharedRecordId } });
    expect(file.label).toContain("Prepared by accountant");
    await expect(
      attachRecordFile(accountantId, unsharedRecordId, {
        fileName: "nope.pdf", bytes: new TextEncoder().encode("%PDF-1.4 test"), label: null,
      }),
    ).rejects.toThrow();
  });

  it("the accountant can open their second-step setup and My account (the sign-in journey's own reads)", async () => {
    // Regression: both reads hand-refused ACCOUNTANT in their actor checks,
    // which left the two-step setup page blank and My account broken.
    const view = await getSecondStepView(accountantId);
    expect(view.allowed).toEqual(["TOTP"]);
    const mine = await getMyAccount(accountantId);
    expect(mine.role).toBe("ACCOUNTANT");
    expect(mine.twoFactorRequired).toBe(true);
  });

  it("the vault refuses the accountant outright", async () => {
    await expect(listCredentials(accountantId)).rejects.toThrow();
  });

  it("removal is owner-only for an accountant, and restoring one needs a new end date", async () => {
    await expect(removeTeamMember(ids.admin, accountantId)).rejects.toThrow();
    await removeTeamMember(ids.owner, accountantId);
    const removed = await prisma.user.findUniqueOrThrow({ where: { id: accountantId } });
    expect(removed.archivedAt).toBeTruthy();
    await expect(restoreTeamMember(ids.owner, accountantId)).rejects.toThrow();
    await restoreTeamMember(ids.owner, accountantId, { accessEndsOn: endOfDenverDayKey("2027-05-01") });
    const restored = await prisma.user.findUniqueOrThrow({ where: { id: accountantId } });
    expect(restored.archivedAt).toBeNull();
    expect(restored.accessEndsOn?.toISOString()).toBe(endOfDenverDayKey("2027-05-01").toISOString());
  });
});
