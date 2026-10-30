import type { NotificationKind, Prisma, Role } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportBackgroundError } from "@/lib/report-error";
import { deliverMessage } from "@/domains/messaging/deliver";
import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";
import { allowedKindsFor, recipientsFor, type NotificationPerson } from "./rules";

/**
 * AR-13: the notifications domain (NOTIFICATIONS.md sections 4 and 5).
 *
 * notify() is called ONLY after the main action commits, and always fire-and-forget from the caller's
 * side (`void notify(...).catch((e) => reportBackgroundError(e, "notify:{kind}"))` or inside after()):
 * a notification can never make a lead submission, a quote view, a signing or a webhook fail.
 * Reads re-read the session user every time: current permissions decide what is shown.
 */

export type NotificationEvent = {
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
  entityType: string;
  entityId: string;
  assigneeId?: string | null;
  creatorId?: string | null;
  excludeUserId?: string | null;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

type Db = Prisma.TransactionClient | typeof prisma;
type ScreensUser = { id: string; role: Role; jobRoleId: string | null };

/**
 * Each person's job-role screens (null = no job role, the access level alone decides). Mirrors
 * screensForUser's fail-closed rule in bulk: a job role that is gone, or no longer matches the
 * person's access level, narrows them to no screens rather than granting everything.
 */
async function screensByUser(db: Db, users: readonly ScreensUser[]): Promise<Map<string, string[] | null>> {
  const roleIds = [...new Set(users.map((u) => u.jobRoleId).filter((v): v is string => Boolean(v)))];
  const roles = roleIds.length
    ? await db.jobRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, screens: true, accessLevel: true } })
    : [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  const out = new Map<string, string[] | null>();
  for (const user of users) {
    if (!user.jobRoleId) {
      out.set(user.id, null);
      continue;
    }
    const role = byId.get(user.jobRoleId);
    out.set(user.id, !role || role.accessLevel !== user.role ? [] : strings(role.screens));
  }
  return out;
}

export async function notify(event: NotificationEvent): Promise<void> {
  if (!event.href.startsWith("/desk/")) {
    throw new Error(`A notification link must start with /desk/ (got "${event.href}").`);
  }
  const title = event.title.slice(0, 160);
  const body = event.body.slice(0, 300);
  const users = await prisma.user.findMany({
    where: { archivedAt: null, role: { in: ["OWNER", "ADMIN", "STAFF"] } },
    select: { id: true, email: true, role: true, archivedAt: true, jobRoleId: true },
  });
  const screens = await screensByUser(prisma, users);
  const people = users.map((u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    archivedAt: u.archivedAt,
    screens: screens.get(u.id) ?? null,
  }));
  const recipients = recipientsFor(event.kind, people, event);
  if (recipients.length === 0) return;

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: recipients.map((r) => r.id) }, kind: event.kind },
    select: { userId: true, inApp: true, email: true },
  });
  const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

  const inApp = recipients.filter((r) => prefByUser.get(r.id)?.inApp ?? true);
  if (inApp.length > 0) {
    // The (userId, dedupeKey) unique plus skipDuplicates makes webhook retries and double views harmless.
    await prisma.notification.createMany({
      data: inApp.map((r) => ({
        userId: r.id,
        kind: event.kind,
        title,
        body,
        href: event.href,
        entityType: event.entityType,
        entityId: event.entityId,
        dedupeKey: event.dedupeKey,
      })),
      skipDuplicates: true,
    });
  }

  // Email is per person and independent of the in-app switch; it rides the existing internal email
  // path (deliverMessage with customerFacing: false), which respects the email switches. One bad
  // send is reported and never stops the others.
  const emailById = new Map(people.map((p) => [p.id, p.email]));
  for (const recipient of recipients) {
    if (!(prefByUser.get(recipient.id)?.email ?? false)) continue;
    try {
      await deliverMessage({
        idempotencyKey: `notification:${event.dedupeKey}:${recipient.id}`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "notification",
        customerFacing: false,
        recipient: { type: "Staff", id: recipient.id, address: emailById.get(recipient.id) ?? "" },
        subject: { type: "Notification", id: event.dedupeKey },
        render: () => ({ subject: title, text: `${body}\n\nOpen it in the desk: ${event.href}` }),
      });
    } catch (error) {
      await reportBackgroundError(error, `notify:email:${event.kind}`);
    }
  }
}

/**
 * The one way hooks fire a notification: after the response when a request scope exists (after()),
 * otherwise as a plain fire-and-forget promise. Either way the error is reported, never thrown —
 * the action that caused the event has already committed and must not fail because of a bell.
 */
export function notifySafely(event: NotificationEvent): void {
  // The report is detached on purpose: reportBackgroundError waits up to ~2.5s for its error
  // service to flush, and nothing on the caller's path (including after()'s drain) may pay that.
  const report = (error: unknown) => {
    void reportBackgroundError(error, `notify:${event.kind}`);
  };
  try {
    after(async () => {
      await notify(event).catch(report);
    });
  } catch {
    void notify(event).catch(report);
  }
}

type NotificationContext = {
  screens: string[] | null;
  allowed: NotificationKind[];
};

async function contextFor(userId: string): Promise<NotificationContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, archivedAt: true, jobRoleId: true },
  });
  if (!user) return null;
  const screens = (await screensByUser(prisma, [user])).get(user.id) ?? null;
  const person: NotificationPerson = { id: user.id, role: user.role, archivedAt: user.archivedAt, screens };
  return { screens, allowed: allowedKindsFor(person) };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const ctx = await contextFor(userId);
  if (!ctx || ctx.allowed.length === 0) return 0;
  return prisma.notification.count({ where: { userId, readAt: null, kind: { in: ctx.allowed } } });
}

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: Date;
  readAt: Date | null;
};

export async function listNotifications(
  userId: string,
  opts: { cursor?: string | null } = {},
): Promise<{ rows: NotificationRow[]; nextCursor: string | null }> {
  const ctx = await contextFor(userId);
  if (!ctx || ctx.allowed.length === 0) return { rows: [], nextCursor: null };
  const found = await prisma.notification.findMany({
    where: { userId, kind: { in: ctx.allowed } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, kind: true, title: true, body: true, href: true, createdAt: true, readAt: true },
  });
  // Rows whose link the person's current job role can no longer open are not shown.
  const visible = found.filter((row) => jobRoleAllowsPath(ctx.screens, row.href));
  return { rows: visible.slice(0, 20), nextCursor: found.length > 20 ? found[19].id : null };
}

export async function markRead(userId: string, id: string): Promise<void> {
  // A single conditional update scoped to the owner of the row: no lock needed, and nobody can
  // ever mark another person's notification.
  await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export type NotificationPreferenceState = { kind: NotificationKind; inApp: boolean; email: boolean };

/** One row per kind the person can receive; no saved row means the starting values (app on, email off). */
export async function getNotificationPreferences(userId: string): Promise<NotificationPreferenceState[]> {
  const ctx = await contextFor(userId);
  if (!ctx) return [];
  const rows = await prisma.notificationPreference.findMany({ where: { userId }, select: { kind: true, inApp: true, email: true } });
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return ctx.allowed.map((kind) => ({
    kind,
    inApp: byKind.get(kind)?.inApp ?? true,
    email: byKind.get(kind)?.email ?? false,
  }));
}

export async function setNotificationPreference(
  userId: string,
  kind: NotificationKind,
  channel: "inApp" | "email",
  on: boolean,
): Promise<void> {
  const ctx = await contextFor(userId);
  if (!ctx || !ctx.allowed.includes(kind)) {
    throw new Error("You don't get that kind of notification.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.notificationPreference.upsert({
      where: { userId_kind: { userId, kind } },
      create: channel === "inApp" ? { userId, kind, inApp: on } : { userId, kind, email: on },
      update: channel === "inApp" ? { inApp: on } : { email: on },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "notification.preference",
        entityType: "NotificationPreference",
        entityId: `${userId}:${kind}`,
        newValue: { channel, on },
      },
    });
  });
}

/**
 * The access-change purge (spec section 5): when a person's access level or job role changes, the
 * notifications of kinds they can no longer receive are deleted in the caller's transaction, with
 * an audit row carrying the count. Re-promotion never brings deleted rows back.
 */
export async function purgeNotificationsForAccess(
  tx: Prisma.TransactionClient,
  input: { actorId: string; userId: string; role: Role; screens: readonly string[] | null },
): Promise<number> {
  const allowed = allowedKindsFor({ id: input.userId, role: input.role, archivedAt: null, screens: input.screens });
  const removed = await tx.notification.deleteMany({
    where: { userId: input.userId, kind: { notIn: allowed } },
  });
  if (removed.count > 0) {
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "notifications.removed_on_access_change",
        entityType: "User",
        entityId: input.userId,
        newValue: { removed: removed.count },
      },
    });
  }
  return removed.count;
}
