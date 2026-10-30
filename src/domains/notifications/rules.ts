import type { NotificationKind, Role } from "@prisma/client";
import { jobRoleAllowsPath } from "@/domains/team/job-role-rules";

/**
 * AR-13: who gets which notification kind (NOTIFICATIONS.md sections 3 and 5). Pure: the domain layer
 * loads people and their job-role screens, these functions decide. The same table drives sending
 * (recipientsFor), reading (allowedKindsFor — CURRENT permissions decide what is shown, not the
 * permissions when the notification was sent) and the preferences page rows.
 */

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "LEAD_NEW",
  "QUOTE_VIEWED",
  "SIGNATURE_DONE",
  "PAYMENT_FAILED",
  "APPROVAL_REQUESTED",
];

/** The desk screen each kind's link opens; the person's job role must allow it. */
export const KIND_SCREEN_HREF: Record<NotificationKind, string> = {
  LEAD_NEW: "/desk/leads",
  QUOTE_VIEWED: "/desk/estimates",
  SIGNATURE_DONE: "/desk/agreements",
  PAYMENT_FAILED: "/desk/billing",
  APPROVAL_REQUESTED: "/desk/approvals",
};

export type NotificationPerson = {
  id: string;
  role: Role;
  archivedAt: Date | null;
  /** The person's job-role screens, or null when they have no job role (access level alone decides). */
  screens: readonly string[] | null;
};

const OWNER_OR_ADMIN: readonly Role[] = ["OWNER", "ADMIN"];

/** The kinds this person may receive and read right now, under their current role and job role. */
export function allowedKindsFor(person: NotificationPerson): NotificationKind[] {
  if (person.archivedAt) return [];
  const kinds: NotificationKind[] = [];
  // LEAD_NEW follows section 3's standing table: OWNER and ADMIN whose job role allows the leads
  // screen. The assignee is an event-level addition in recipientsFor, not a standing kind — section 5
  // pins allowedKindsFor to the same table, and a staff member's preferences page is the empty state.
  if (
    OWNER_OR_ADMIN.includes(person.role) &&
    jobRoleAllowsPath(person.screens, KIND_SCREEN_HREF.LEAD_NEW)
  ) {
    kinds.push("LEAD_NEW");
  }
  if (OWNER_OR_ADMIN.includes(person.role)) {
    if (jobRoleAllowsPath(person.screens, KIND_SCREEN_HREF.QUOTE_VIEWED)) kinds.push("QUOTE_VIEWED");
    if (jobRoleAllowsPath(person.screens, KIND_SCREEN_HREF.SIGNATURE_DONE)) kinds.push("SIGNATURE_DONE");
    if (jobRoleAllowsPath(person.screens, KIND_SCREEN_HREF.PAYMENT_FAILED)) kinds.push("PAYMENT_FAILED");
  }
  if (person.role === "OWNER" && jobRoleAllowsPath(person.screens, KIND_SCREEN_HREF.APPROVAL_REQUESTED)) {
    kinds.push("APPROVAL_REQUESTED");
  }
  return kinds;
}

export type RecipientOptions = {
  /** The record link this event will carry; the job role must allow opening it. */
  href: string;
  /** LEAD_NEW: the lead's assignee also receives it (any team role with leads access). */
  assigneeId?: string | null;
  /** QUOTE_VIEWED: the quote's creator also receives it, when they are owner/admin. */
  creatorId?: string | null;
  /** LEAD_NEW: the person who created the lead by hand never receives it. */
  excludeUserId?: string | null;
};

/** The people who receive one event of this kind (spec section 3's recipient table). */
export function recipientsFor(
  kind: NotificationKind,
  people: readonly NotificationPerson[],
  opts: RecipientOptions,
): NotificationPerson[] {
  const seen = new Set<string>();
  const out: NotificationPerson[] = [];
  const add = (person: NotificationPerson | undefined) => {
    if (!person || person.archivedAt) return;
    if (person.role === "CUSTOMER" || person.role === "ACCOUNTANT") return;
    if (opts.excludeUserId && person.id === opts.excludeUserId) return;
    if (seen.has(person.id)) return;
    seen.add(person.id);
    out.push(person);
  };
  const canOpen = (person: NotificationPerson) => jobRoleAllowsPath(person.screens, opts.href);
  for (const person of people) {
    if (person.archivedAt) continue;
    if (kind === "APPROVAL_REQUESTED") {
      if (person.role === "OWNER" && canOpen(person)) add(person);
    } else if (kind === "LEAD_NEW") {
      if (OWNER_OR_ADMIN.includes(person.role) && canOpen(person)) add(person);
    } else {
      // QUOTE_VIEWED, SIGNATURE_DONE, PAYMENT_FAILED: owner and admin who can open the record.
      if (OWNER_OR_ADMIN.includes(person.role) && canOpen(person)) add(person);
    }
  }
  if (kind === "LEAD_NEW" && opts.assigneeId) {
    const assignee = people.find((p) => p.id === opts.assigneeId);
    if (assignee && canOpen(assignee)) add(assignee);
  }
  if (kind === "QUOTE_VIEWED" && opts.creatorId) {
    const creator = people.find((p) => p.id === opts.creatorId);
    if (creator && OWNER_OR_ADMIN.includes(creator.role) && canOpen(creator)) add(creator);
  }
  return out;
}
