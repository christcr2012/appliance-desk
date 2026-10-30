"use server";

import type { NotificationKind } from "@prisma/client";
import { requireSession } from "@/lib/session";
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  setNotificationPreference,
} from "@/domains/notifications";
import { NOTIFICATION_KINDS } from "@/domains/notifications/rules";

/**
 * AR-13: the bell's server actions. Every one takes the person from the session and nothing else —
 * no action accepts a user id, so nobody can read or mark another person's notifications.
 */

export type NotificationRowDto = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

export async function getUnreadCountAction(): Promise<number> {
  const session = await requireSession();
  return getUnreadCount(session.user.id);
}

export async function listNotificationsAction(
  cursor: string | null = null,
): Promise<{ rows: NotificationRowDto[]; nextCursor: string | null }> {
  const session = await requireSession();
  const { rows, nextCursor } = await listNotifications(session.user.id, { cursor });
  return {
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
    nextCursor,
  };
}

export async function markReadAction(id: string): Promise<void> {
  const session = await requireSession();
  await markRead(session.user.id, id);
}

export async function markAllReadAction(): Promise<void> {
  const session = await requireSession();
  await markAllRead(session.user.id);
}

/** The kit Switch contract: fields carry kind + channel, the switch adds "checked". */
export async function setNotificationPreferenceAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const kind = String(formData.get("kind") ?? "") as NotificationKind;
  const channel = String(formData.get("channel") ?? "");
  if (!NOTIFICATION_KINDS.includes(kind) || (channel !== "inApp" && channel !== "email")) {
    return { ok: false, error: "That notification setting isn't available." };
  }
  try {
    await setNotificationPreference(session.user.id, kind, channel, formData.get("checked") === "true");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't save that setting." };
  }
}
