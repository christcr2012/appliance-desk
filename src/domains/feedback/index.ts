import { randomBytes } from "node:crypto";
import { del, put } from "@vercel/blob";
import { Prisma, type FeedbackState, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession, requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { isRateLimited } from "@/lib/rate-limit";
import { getPrivatePhotoStore } from "@/lib/photo-storage";
import { appRevisionFrom, readSafeContext, safeContextFrom, toRouteTemplate, type FeedbackSafeContext } from "./context";
import { cleanScreenshot, feedbackAttachmentPath, MAX_SCREENSHOT_BYTES } from "./media";
import { getFeedbackSettings } from "./settings";
import {
  CHANGED, FeedbackError, NOT_FOUND, PAGE_STEP, PICTURES_UNAVAILABLE, RATE_LIMITED, SCREENSHOT_TOO_LARGE, WINDOW_CAP,
  allowedTriageTargets, canReopen, canTriageMove, checkReason, decodeCursor, idSchema, isFinalState, messageSchema,
  reasonSchema, submitFeedbackSchema, versionSchema, windowRows,
  type FeedbackStateName, type SubmitFeedbackInput,
} from "./rules";

// MCP-10a: the app feedback box (people only). Everyone signed in can report a problem with the app or suggest an
// improvement and follow their own reports; only the owner and admins read everyone's reports and answer them.
// Every function re-reads the signed-in person. STAFF and CUSTOMER only ever reach their OWN reports: every reporter
// query filters on reporterUserId = the signed-in person, and "not yours" looks exactly like "not found".
// No AI or ops tool reads this module (tests/feedback-no-ai.test.ts); every report is HUMAN_ONLY.

export { FeedbackError } from "./rules";

const BUSINESS_NAME = "Robinson Appliance Rentals";
const SUBMIT_RATE = { max: 5, windowMs: 3_600_000 } as const;
const UPLOAD_RATE = { max: 20, windowMs: 3_600_000 } as const;

type Actor = { id: string; role: Role };

/** The signed-in person, re-read from the database (active only). */
async function reporterActor(): Promise<Actor> {
  const session = await getServerSession();
  const id = session?.user?.id;
  if (!id) throw new FeedbackError("Please sign in again.");
  const user = await prisma.user.findFirst({ where: { id, archivedAt: null }, select: { id: true, role: true } });
  if (!user) throw new FeedbackError("Please sign in again.");
  return user;
}

/** OWNER or ADMIN, re-read from the database. */
async function triageActor(): Promise<Actor> {
  const session = await requireRole("OWNER", "ADMIN");
  const user = await prisma.user.findFirst({
    where: { id: session.user.id, archivedAt: null, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true, role: true },
  });
  if (!user) throw new FeedbackError("This account no longer has access to make that change.");
  return user;
}

/** Inside a write: lock the person's row (serializes with deactivation) and check they are still active. */
async function lockReporter(tx: Prisma.TransactionClient, userId: string): Promise<Actor> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, archivedAt: true } });
  if (!user || user.archivedAt) throw new FeedbackError("This account no longer has access to make that change.");
  // A privacy deletion that is being carried out (claimed by the owner) locks this same row first; once it is
  // claimed, nothing new is saved for this person, so no picture or text can slip in after the deletion's list.
  const customer = await tx.customer.findUnique({ where: { userId }, select: { id: true } });
  const deleting = customer
    ? await tx.privacyRequest.findFirst({
        where: { kind: "DELETE", status: "VERIFIED", fulfilledByUserId: { not: null }, customerId: customer.id },
        select: { id: true },
      })
    : null;
  if (deleting) throw new FeedbackError("This account no longer has access to make that change.");
  return { id: user.id, role: user.role };
}

const lockedReportSelect = {
  id: true, number: true, reporterUserId: true, state: true, version: true, closedAt: true,
  awaitingTeam: true, contentRemovedAt: true, duplicateOfId: true,
} as const;

/** SELECT … FOR UPDATE, then the row. Reporters only ever get their own report; anything else is "Not found". */
async function lockReport(tx: Prisma.TransactionClient, id: string, reporterUserId?: string) {
  if (!idSchema.safeParse(id).success) throw new FeedbackError(NOT_FOUND);
  await tx.$queryRaw`SELECT "id" FROM "FeedbackReport" WHERE "id" = ${id} FOR UPDATE`;
  const report = await tx.feedbackReport.findUnique({ where: { id }, select: lockedReportSelect });
  if (!report) throw new FeedbackError(NOT_FOUND);
  if (reporterUserId !== undefined && (report.reporterUserId !== reporterUserId || report.contentRemovedAt)) {
    throw new FeedbackError(NOT_FOUND);
  }
  return report;
}

function checkVersion(report: { version: number }, expectedVersion: number) {
  if (!versionSchema.safeParse(expectedVersion).success || report.version !== expectedVersion) {
    throw new FeedbackError(CHANGED, true);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function newAttachmentId(): string {
  return "fa" + randomBytes(12).toString("hex");
}

// ---------------------------------------------------------------------------
// Sending a report (reporter)
// ---------------------------------------------------------------------------

export type SubmitMeta = { userAgent?: string | null; language?: string | null };

/**
 * Sends a report WITHOUT pictures (each picture follows in its own call, so no request goes over the app-wide 1 MB
 * limit). The same requestKey twice (a double click, a retry) returns the first report instead of a second one.
 */
export async function submitFeedback(
  raw: SubmitFeedbackInput,
  meta: SubmitMeta = {},
): Promise<{ id: string; number: number; maxAttachments: number }> {
  const actor = await reporterActor();
  const parsed = submitFeedbackSchema.safeParse(raw);
  if (!parsed.success) throw new FeedbackError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const input = parsed.data;
  const settings = await getFeedbackSettings();

  const existing = await prisma.feedbackReport.findUnique({
    where: { reporterUserId_requestKey: { reporterUserId: actor.id, requestKey: input.requestKey } },
    select: { id: true, number: true },
  });
  if (existing) return { ...existing, maxAttachments: settings.maxAttachments };

  if (await isRateLimited("feedback:" + actor.id, SUBMIT_RATE)) throw new FeedbackError(RATE_LIMITED);

  const safeContext: FeedbackSafeContext = safeContextFrom(meta.userAgent, meta.language);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const locked = await lockReporter(tx, actor.id);
      const report = await tx.feedbackReport.create({
        data: {
          reporterUserId: locked.id,
          reporterRole: locked.role,
          kind: input.kind,
          title: input.title,
          description: input.description,
          expected: input.kind === "BUG" ? input.expected : null,
          steps: input.kind === "BUG" ? input.steps : null,
          routeTemplate: toRouteTemplate(input.path),
          appRevision: appRevisionFrom(process.env.VERCEL_GIT_COMMIT_SHA),
          safeContext,
          aiReview: "HUMAN_ONLY",
          state: "SUBMITTED",
          awaitingTeam: true,
          requestKey: input.requestKey,
        },
        select: { id: true, number: true },
      });
      await tx.feedbackEvent.create({
        data: { reportId: report.id, actorUserId: locked.id, action: "SUBMITTED", toState: "SUBMITTED" },
      });
      return report;
    });
    return { ...created, maxAttachments: settings.maxAttachments };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const first = await prisma.feedbackReport.findUnique({
      where: { reporterUserId_requestKey: { reporterUserId: actor.id, requestKey: input.requestKey } },
      select: { id: true, number: true },
    });
    if (!first) throw error;
    return { ...first, maxAttachments: settings.maxAttachments };
  }
}

export type ScreenshotResult =
  | { status: "saved"; id: string; left: number }
  | { status: "unavailable"; message: string };

/**
 * One picture for one of the person's own open reports, under the owner's count limit. Checked by its first bytes,
 * re-made as WebP without location data, stored privately; the database row is written only after the file is saved.
 */
export async function addFeedbackScreenshot(reportId: string, file: Blob): Promise<ScreenshotResult> {
  const actor = await reporterActor();
  if (!idSchema.safeParse(reportId).success) throw new FeedbackError(NOT_FOUND);
  const settings = await getFeedbackSettings();
  const precheck = await prisma.feedbackReport.findFirst({
    where: { id: reportId, reporterUserId: actor.id, contentRemovedAt: null },
    select: { id: true, state: true, _count: { select: { attachments: { where: { deletedAt: null } } } } },
  });
  if (!precheck) throw new FeedbackError(NOT_FOUND);
  if (isFinalState(precheck.state)) throw new FeedbackError("This report is finished, so pictures can't be added.");
  if (precheck._count.attachments >= settings.maxAttachments) {
    throw new FeedbackError(settings.maxAttachments === 0
      ? "Pictures are turned off for app feedback."
      : `A report can have up to ${settings.maxAttachments} pictures.`);
  }
  if (typeof file?.size !== "number" || file.size > MAX_SCREENSHOT_BYTES) throw new FeedbackError(SCREENSHOT_TOO_LARGE);
  const store = getPrivatePhotoStore();
  if (!store) return { status: "unavailable", message: PICTURES_UNAVAILABLE };
  if (await isRateLimited("feedback-upload:" + actor.id, UPLOAD_RATE)) throw new FeedbackError(RATE_LIMITED);

  const clean = await cleanScreenshot(new Uint8Array(await file.arrayBuffer()));
  const attachmentId = newAttachmentId();
  const pathname = feedbackAttachmentPath(reportId, attachmentId);
  const stored = await put(pathname, clean.bytes, {
    token: store.token, access: "private", contentType: "image/webp", addRandomSuffix: false,
    abortSignal: AbortSignal.timeout(15_000),
  });
  try {
    const left = await prisma.$transaction(async (tx) => {
      await lockReporter(tx, actor.id);
      const report = await lockReport(tx, reportId, actor.id);
      if (isFinalState(report.state)) throw new FeedbackError("This report is finished, so pictures can't be added.");
      const count = await tx.feedbackAttachment.count({ where: { reportId, deletedAt: null } });
      if (count >= settings.maxAttachments) throw new FeedbackError(`A report can have up to ${settings.maxAttachments} pictures.`);
      await tx.feedbackAttachment.create({
        data: {
          id: attachmentId, reportId, uploaderId: actor.id, pathname, sizeBytes: clean.sizeBytes,
          sha256: clean.sha256, width: clean.width, height: clean.height,
        },
      });
      await tx.feedbackEvent.create({ data: { reportId, actorUserId: actor.id, action: "ATTACHMENT_ADDED" } });
      return settings.maxAttachments - count - 1;
    });
    return { status: "saved", id: attachmentId, left };
  } catch (error) {
    // Best effort: a picture the database never recorded must not linger in private storage.
    await del(stored.url, { token: store.token }).catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The person's own reports (reporter)
// ---------------------------------------------------------------------------

export type MyFeedbackRow = { id: string; number: number; title: string; state: FeedbackStateName; updatedAt: Date };
export type Page<T> = { rows: T[]; nextCursor: string | null; atCap: boolean };

async function windowSizeFor(where: Prisma.FeedbackReportWhereInput, rawCursor: string | null | undefined, sortField: "createdAt" | "updatedAt") {
  const cursor = decodeCursor(rawCursor);
  if (!cursor) return PAGE_STEP;
  const at = new Date(cursor.v);
  const through = await prisma.feedbackReport.count({
    where: { AND: [where, { OR: [{ [sortField]: { gt: at } }, { [sortField]: at, id: { gte: cursor.id } }] }] },
  });
  return Math.min(WINDOW_CAP, Math.max(PAGE_STEP, through + PAGE_STEP));
}

export async function listMyFeedback(cursor?: string | null): Promise<Page<MyFeedbackRow>> {
  const actor = await reporterActor();
  const where: Prisma.FeedbackReportWhereInput = { reporterUserId: actor.id, contentRemovedAt: null };
  const size = await windowSizeFor(where, cursor, "createdAt");
  const rows = await prisma.feedbackReport.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: size + 1,
    select: { id: true, number: true, title: true, state: true, updatedAt: true, createdAt: true },
  });
  const page = windowRows(rows, size, (row) => row.createdAt);
  return {
    ...page,
    rows: page.rows.map((row) => ({ id: row.id, number: row.number, title: row.title, state: row.state, updatedAt: row.updatedAt })),
  };
}

export type ConversationEntry = { id: string; who: string; mine: boolean; body: string; at: Date };
export type MyFeedbackDetail = {
  id: string; number: number; version: number; kind: "BUG" | "IMPROVEMENT"; title: string; description: string;
  expected: string | null; steps: string | null; state: FeedbackStateName; createdAt: Date; updatedAt: Date;
  closedAt: Date | null; entries: ConversationEntry[]; attachments: { id: string; width: number; height: number }[];
  canReopen: boolean; canAddPictures: boolean; picturesLeft: number;
};

function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "Someone";
}

export async function getMyFeedback(id: string): Promise<MyFeedbackDetail> {
  const actor = await reporterActor();
  if (!idSchema.safeParse(id).success) throw new FeedbackError(NOT_FOUND);
  const report = await prisma.feedbackReport.findFirst({
    where: { id, reporterUserId: actor.id, contentRemovedAt: null },
    select: {
      id: true, number: true, version: true, kind: true, title: true, description: true, expected: true, steps: true,
      state: true, createdAt: true, updatedAt: true, closedAt: true,
      // Only what the reporter may see: REPORTER entries (never internal notes), live pictures.
      entries: {
        where: { visibility: "REPORTER" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, body: true, createdAt: true, authorUserId: true, author: { select: { name: true } } },
      },
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, width: true, height: true } },
    },
  });
  if (!report) throw new FeedbackError(NOT_FOUND);
  const settings = await getFeedbackSettings();
  const now = new Date();
  return {
    id: report.id, number: report.number, version: report.version, kind: report.kind, title: report.title,
    description: report.description, expected: report.expected, steps: report.steps, state: report.state,
    createdAt: report.createdAt, updatedAt: report.updatedAt, closedAt: report.closedAt,
    entries: report.entries.map((entry) => ({
      id: entry.id,
      mine: entry.authorUserId === actor.id,
      who: entry.authorUserId === actor.id ? "You" : `${firstName(entry.author.name)} at ${BUSINESS_NAME}`,
      body: entry.body,
      at: entry.createdAt,
    })),
    attachments: report.attachments,
    canReopen: canReopen(report.state, report.closedAt, settings.reopenDays, now),
    canAddPictures: !isFinalState(report.state) && report.attachments.length < settings.maxAttachments,
    picturesLeft: Math.max(0, settings.maxAttachments - report.attachments.length),
  };
}

/** Reporter adds details (and answers a question): NEEDS_INFORMATION → TRIAGED. */
export async function addFeedbackDetails(id: string, expectedVersion: number, body: string): Promise<void> {
  const actor = await reporterActor();
  const text = messageSchema.parse(body);
  await prisma.$transaction(async (tx) => {
    await lockReporter(tx, actor.id);
    const report = await lockReport(tx, id, actor.id);
    checkVersion(report, expectedVersion);
    if (isFinalState(report.state)) throw new FeedbackError("This report is finished. Use “It's still not right” to reopen it.");
    const toState: FeedbackState = report.state === "NEEDS_INFORMATION" ? "TRIAGED" : report.state;
    await tx.feedbackEntry.create({ data: { reportId: id, authorUserId: actor.id, visibility: "REPORTER", body: text } });
    await tx.feedbackReport.update({ where: { id }, data: { state: toState, awaitingTeam: true, version: { increment: 1 } } });
    await tx.feedbackEvent.create({
      data: { reportId: id, actorUserId: actor.id, action: "DETAILS_ADDED", fromState: report.state, toState },
    });
  });
}

/** Reporter closes their own open report. */
export async function closeMyFeedback(id: string, expectedVersion: number): Promise<void> {
  const actor = await reporterActor();
  await prisma.$transaction(async (tx) => {
    await lockReporter(tx, actor.id);
    const report = await lockReport(tx, id, actor.id);
    checkVersion(report, expectedVersion);
    if (isFinalState(report.state)) throw new FeedbackError("This report is already finished.");
    await tx.feedbackReport.update({
      where: { id }, data: { state: "CLOSED", closedAt: new Date(), awaitingTeam: false, version: { increment: 1 } },
    });
    await tx.feedbackEvent.create({
      data: { reportId: id, actorUserId: actor.id, action: "CLOSED_BY_REPORTER", fromState: report.state, toState: "CLOSED" },
    });
  });
}

/** "It's still not right": a finished report goes back to "Being looked at" within the owner's reopen window. */
export async function reopenMyFeedback(id: string, expectedVersion: number, why: string): Promise<void> {
  const actor = await reporterActor();
  const text = reasonSchema.parse(why);
  const settings = await getFeedbackSettings();
  await prisma.$transaction(async (tx) => {
    await lockReporter(tx, actor.id);
    const report = await lockReport(tx, id, actor.id);
    checkVersion(report, expectedVersion);
    if (!canReopen(report.state, report.closedAt, settings.reopenDays, new Date())) {
      throw new FeedbackError(isFinalState(report.state)
        ? `Reports can be reopened for ${settings.reopenDays} days after they are finished. Please send a new report.`
        : "This report is still open. Use “Add details” instead.");
    }
    await tx.feedbackEntry.create({ data: { reportId: id, authorUserId: actor.id, visibility: "REPORTER", body: text } });
    await tx.feedbackReport.update({
      where: { id },
      data: { state: "TRIAGED", closedAt: null, duplicateOfId: null, awaitingTeam: true, version: { increment: 1 } },
    });
    await tx.feedbackEvent.create({
      data: { reportId: id, actorUserId: actor.id, action: "REOPENED", fromState: report.state, toState: "TRIAGED" },
    });
  });
}

// ---------------------------------------------------------------------------
// Triage (OWNER / ADMIN only)
// ---------------------------------------------------------------------------

export const TRIAGE_TABS = ["new", "answered", "open", "waiting", "planned", "done"] as const;
export type TriageTab = (typeof TRIAGE_TABS)[number];
export const TRIAGE_TAB_LABELS: Record<TriageTab, string> = {
  new: "New", answered: "They answered", open: "Open", waiting: "Waiting on them", planned: "Planned", done: "Done",
};
const OPEN_STATES: FeedbackState[] = ["SUBMITTED", "TRIAGED", "NEEDS_INFORMATION", "ACCEPTED", "IN_PROGRESS", "AWAITING_VERIFICATION"];
const DONE_STATES: FeedbackState[] = ["RESOLVED", "DUPLICATE", "DECLINED", "CLOSED"];
const PLANNED_STATES: FeedbackState[] = ["ACCEPTED", "IN_PROGRESS", "AWAITING_VERIFICATION"];

function tabWhere(tab: TriageTab): Prisma.FeedbackReportWhereInput {
  switch (tab) {
    case "new": return { state: "SUBMITTED" };
    case "answered": return { awaitingTeam: true, state: { in: OPEN_STATES.filter((s) => s !== "SUBMITTED") } };
    case "open": return { state: { in: OPEN_STATES } };
    case "waiting": return { state: "NEEDS_INFORMATION" };
    case "planned": return { state: { in: PLANNED_STATES } };
    case "done": return { state: { in: DONE_STATES } };
  }
}

export type TriageParams = {
  tab?: TriageTab; kind?: "BUG" | "IMPROVEMENT" | null; from?: "customers" | "team" | null; q?: string | null;
  reporter?: string | null; cursor?: string | null;
};
export type TriageRow = {
  id: string; number: number; title: string; reporterName: string; reporterRole: Role; kind: "BUG" | "IMPROVEMENT";
  state: FeedbackStateName; awaitingTeam: boolean; updatedAt: Date;
};

function filterWhere(params: TriageParams): Prisma.FeedbackReportWhereInput {
  const and: Prisma.FeedbackReportWhereInput[] = [];
  if (params.kind === "BUG" || params.kind === "IMPROVEMENT") and.push({ kind: params.kind });
  if (params.from === "customers") and.push({ reporterRole: "CUSTOMER" });
  if (params.from === "team") and.push({ reporterRole: { in: ["OWNER", "ADMIN", "STAFF"] } });
  if (params.reporter && idSchema.safeParse(params.reporter).success) and.push({ reporterUserId: params.reporter });
  const q = (params.q ?? "").trim().slice(0, 160);
  if (q) {
    const number = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
    and.push(number !== null ? { number } : { title: { contains: q, mode: "insensitive" } });
  }
  return and.length ? { AND: and } : {};
}

export async function listFeedbackForTriage(params: TriageParams = {}): Promise<Page<TriageRow> & { counts: Record<TriageTab, number> }> {
  await triageActor();
  const tab: TriageTab = TRIAGE_TABS.includes(params.tab as TriageTab) ? (params.tab as TriageTab) : "new";
  const filters = filterWhere(params);
  const where: Prisma.FeedbackReportWhereInput = { AND: [filters, tabWhere(tab)] };
  const size = await windowSizeFor(where, params.cursor, "updatedAt");
  const [rows, grouped] = await Promise.all([
    prisma.feedbackReport.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: size + 1,
      select: {
        id: true, number: true, title: true, reporterRole: true, kind: true, state: true, awaitingTeam: true, updatedAt: true,
        reporter: { select: { name: true, email: true } },
      },
    }),
    // One grouped count with the same filters except the tab.
    prisma.feedbackReport.groupBy({ by: ["state", "awaitingTeam"], where: filters, _count: { _all: true } }),
  ]);
  const counts: Record<TriageTab, number> = { new: 0, answered: 0, open: 0, waiting: 0, planned: 0, done: 0 };
  for (const group of grouped) {
    const n = group._count._all;
    if (group.state === "SUBMITTED") counts.new += n;
    if (OPEN_STATES.includes(group.state)) counts.open += n;
    if (group.awaitingTeam && OPEN_STATES.includes(group.state) && group.state !== "SUBMITTED") counts.answered += n;
    if (group.state === "NEEDS_INFORMATION") counts.waiting += n;
    if (PLANNED_STATES.includes(group.state)) counts.planned += n;
    if (DONE_STATES.includes(group.state)) counts.done += n;
  }
  const page = windowRows(rows, size, (row) => row.updatedAt);
  return {
    ...page,
    counts,
    rows: page.rows.map((row) => ({
      id: row.id, number: row.number, title: row.title, reporterName: row.reporter.name || row.reporter.email,
      reporterRole: row.reporterRole, kind: row.kind, state: row.state, awaitingTeam: row.awaitingTeam, updatedAt: row.updatedAt,
    })),
  };
}

export type TriageDetail = {
  id: string; number: number; version: number; kind: "BUG" | "IMPROVEMENT"; title: string; description: string;
  expected: string | null; steps: string | null; state: FeedbackStateName; awaitingTeam: boolean;
  routeTemplate: string; appRevision: string | null; safeContext: FeedbackSafeContext; createdAt: Date; updatedAt: Date;
  closedAt: Date | null; contentRemoved: boolean; reporter: { id: string; name: string; role: Role };
  reporterOtherReports: number; duplicateOf: { id: string; number: number } | null;
  entries: { id: string; who: string; visibility: "REPORTER" | "INTERNAL"; fromReporter: boolean; body: string; at: Date }[];
  events: { id: string; action: string; who: string; fromState: FeedbackStateName | null; toState: FeedbackStateName | null; reason: string | null; at: Date }[];
  attachments: { id: string; width: number; height: number; deleted: boolean }[];
  allowedStates: FeedbackStateName[]; canMarkDuplicate: boolean;
};

export async function getFeedbackForTriage(id: string): Promise<TriageDetail> {
  await triageActor();
  if (!idSchema.safeParse(id).success) throw new FeedbackError(NOT_FOUND);
  const report = await prisma.feedbackReport.findUnique({
    where: { id },
    select: {
      id: true, number: true, version: true, kind: true, title: true, description: true, expected: true, steps: true,
      state: true, awaitingTeam: true, routeTemplate: true, appRevision: true, safeContext: true, createdAt: true,
      updatedAt: true, closedAt: true, contentRemovedAt: true, reporterUserId: true, reporterRole: true,
      reporter: { select: { name: true, email: true } },
      duplicateOf: { select: { id: true, number: true } },
      entries: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, visibility: true, body: true, createdAt: true, authorUserId: true, author: { select: { name: true, email: true } } },
      },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, action: true, actorUserId: true, fromState: true, toState: true, reason: true, createdAt: true } },
      attachments: { orderBy: { createdAt: "asc" }, select: { id: true, width: true, height: true, deletedAt: true } },
    },
  });
  if (!report) throw new FeedbackError(NOT_FOUND);
  const actorIds = [...new Set(report.events.map((event) => event.actorUserId).filter((value): value is string => !!value))];
  const [actors, otherReports] = await Promise.all([
    actorIds.length ? prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }) : [],
    prisma.feedbackReport.count({ where: { reporterUserId: report.reporterUserId, id: { not: report.id } } }),
  ]);
  const nameOf = new Map(actors.map((user) => [user.id, user.name || user.email]));
  const final = isFinalState(report.state);
  return {
    id: report.id, number: report.number, version: report.version, kind: report.kind, title: report.title,
    description: report.description, expected: report.expected, steps: report.steps, state: report.state,
    awaitingTeam: report.awaitingTeam, routeTemplate: report.routeTemplate, appRevision: report.appRevision,
    safeContext: readSafeContext(report.safeContext), createdAt: report.createdAt, updatedAt: report.updatedAt,
    closedAt: report.closedAt, contentRemoved: report.contentRemovedAt !== null,
    reporter: { id: report.reporterUserId, name: report.reporter.name || report.reporter.email, role: report.reporterRole },
    reporterOtherReports: otherReports,
    duplicateOf: report.duplicateOf,
    entries: report.entries.map((entry) => ({
      id: entry.id, visibility: entry.visibility, fromReporter: entry.authorUserId === report.reporterUserId,
      who: entry.author.name || entry.author.email, body: entry.body, at: entry.createdAt,
    })),
    events: report.events.map((event) => ({
      id: event.id, action: event.action, who: event.actorUserId ? nameOf.get(event.actorUserId) ?? "Former team member" : "The app",
      fromState: event.fromState, toState: event.toState, reason: event.reason, at: event.createdAt,
    })),
    attachments: report.attachments.map((row) => ({ id: row.id, width: row.width, height: row.height, deleted: row.deletedAt !== null })),
    allowedStates: final ? [] : allowedTriageTargets(report.state),
    canMarkDuplicate: canTriageMove(report.state, "DUPLICATE", { includeDuplicate: true }),
  };
}

async function triageWrite<T>(id: string, work: (tx: Prisma.TransactionClient, report: Awaited<ReturnType<typeof lockReport>>, actor: Actor) => Promise<T>): Promise<T> {
  const actor = await triageActor();
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actor.id, ["OWNER", "ADMIN"]);
    const report = await lockReport(tx, id);
    if (report.contentRemovedAt) throw new FeedbackError("This report's content was removed at the person's request.");
    return work(tx, report, actor);
  });
}

function stateData(to: FeedbackState, now: Date) {
  return { state: to, closedAt: isFinalState(to) ? now : null };
}

/** A message the reporter sees, optionally moving the report on ("and mark as"). */
export async function replyToReporter(id: string, expectedVersion: number, body: string, nextState?: FeedbackStateName | null): Promise<void> {
  const text = messageSchema.parse(body);
  await triageWrite(id, async (tx, report, actor) => {
    checkVersion(report, expectedVersion);
    const now = new Date();
    let to: FeedbackState = report.state;
    let reason: string | null = null;
    if (nextState && nextState !== report.state) {
      if (!canTriageMove(report.state, nextState)) throw new FeedbackError("That status change isn't allowed from here.");
      // For "Fixed" / "Not planned" the reply itself is the recorded reason.
      reason = checkReason(nextState, text.slice(0, 500));
      to = nextState;
    }
    await tx.feedbackEntry.create({ data: { reportId: id, authorUserId: actor.id, visibility: "REPORTER", body: text } });
    await tx.feedbackReport.update({
      where: { id },
      data: { ...(to !== report.state ? stateData(to, now) : {}), awaitingTeam: false, version: { increment: 1 } },
    });
    await tx.feedbackEvent.create({ data: { reportId: id, actorUserId: actor.id, action: "REPLIED" } });
    if (to !== report.state) {
      await tx.feedbackEvent.create({
        data: { reportId: id, actorUserId: actor.id, action: "STATE_CHANGED", fromState: report.state, toState: to, reason },
      });
    }
  });
}

/** A note only the team sees ("Only your team sees this"). It never changes what the reporter sees. */
export async function addInternalNote(id: string, body: string): Promise<void> {
  const text = messageSchema.parse(body);
  await triageWrite(id, async (tx, _report, actor) => {
    await tx.feedbackEntry.create({ data: { reportId: id, authorUserId: actor.id, visibility: "INTERNAL", body: text } });
    await tx.feedbackEvent.create({ data: { reportId: id, actorUserId: actor.id, action: "NOTE_ADDED" } });
  });
}

/** Change status (allowed changes only; a reason is required for "Fixed", "Not planned" and "Already reported"). */
export async function setFeedbackState(id: string, expectedVersion: number, toState: FeedbackStateName, reasonText?: string | null): Promise<void> {
  await triageWrite(id, async (tx, report, actor) => {
    checkVersion(report, expectedVersion);
    if (!canTriageMove(report.state, toState)) throw new FeedbackError("That status change isn't allowed from here.");
    const reason = checkReason(toState, reasonText);
    await tx.feedbackReport.update({
      where: { id }, data: { ...stateData(toState, new Date()), awaitingTeam: false, version: { increment: 1 } },
    });
    await tx.feedbackEvent.create({
      data: { reportId: id, actorUserId: actor.id, action: "STATE_CHANGED", fromState: report.state, toState, reason },
    });
  });
}

/** "Mark as already reported": links to the other report. The reporter only ever sees "Already reported". */
export async function markDuplicate(id: string, expectedVersion: number, ofNumber: number): Promise<void> {
  if (!Number.isInteger(ofNumber) || ofNumber < 1) throw new FeedbackError("Enter the other report's number.");
  await triageWrite(id, async (tx, report, actor) => {
    checkVersion(report, expectedVersion);
    if (!canTriageMove(report.state, "DUPLICATE", { includeDuplicate: true })) {
      throw new FeedbackError("Only a new or looked-at report can be marked as already reported.");
    }
    const target = await tx.feedbackReport.findUnique({ where: { number: ofNumber }, select: { id: true, duplicateOfId: true } });
    if (!target) throw new FeedbackError(`There is no report #${ofNumber}.`);
    if (target.id === report.id) throw new FeedbackError("A report can't be a copy of itself.");
    if (target.duplicateOfId === report.id) throw new FeedbackError(`Report #${ofNumber} is already marked as a copy of this one.`);
    const reason = checkReason("DUPLICATE", `Same as report #${ofNumber}`);
    await tx.feedbackReport.update({
      where: { id },
      data: { ...stateData("DUPLICATE", new Date()), duplicateOfId: target.id, awaitingTeam: false, version: { increment: 1 } },
    });
    await tx.feedbackEvent.create({
      data: { reportId: id, actorUserId: actor.id, action: "MARKED_DUPLICATE", fromState: report.state, toState: "DUPLICATE", reason },
    });
  });
}

// ---------------------------------------------------------------------------
// Pictures: who may see one (used by the read route)
// ---------------------------------------------------------------------------

/** The stored pathname when the signed-in person may see this picture: triage, or the report's own sender. */
export async function feedbackAttachmentForViewer(attachmentId: string, viewer: { id: string; role: string }): Promise<string | null> {
  if (!idSchema.safeParse(attachmentId).success) return null;
  const user = await prisma.user.findFirst({ where: { id: viewer.id, archivedAt: null }, select: { id: true, role: true } });
  if (!user) return null;
  const row = await prisma.feedbackAttachment.findUnique({
    where: { id: attachmentId },
    select: { pathname: true, deletedAt: true, report: { select: { reporterUserId: true, contentRemovedAt: true } } },
  });
  if (!row || row.deletedAt || row.report.contentRemovedAt) return null;
  const triage = user.role === "OWNER" || user.role === "ADMIN";
  if (!triage && row.report.reporterUserId !== user.id) return null;
  if (!row.pathname.startsWith("feedback/")) return null;
  return row.pathname;
}
