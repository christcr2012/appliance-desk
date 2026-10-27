import { prisma } from "@/lib/prisma";
import { businessDateKey } from "@/lib/business-date";
import type { ExceptionItem } from "@/domains/exceptions/rules";
import { accessEndAttentionKind } from "./rules";
import { unseenAccountantChangeCount } from "./index";

// ACCT-1: the owner's To do items about the accountant — the access-end warnings (spec section 3: "{name}'s
// access ends on {date}", 14 days before; a 6-month reminder for open-ended access) and the Today card
// when there are accountant changes the owner has not looked at yet (spec section 4). Owner-only data:
// the exceptions index calls this only for the OWNER.

export async function listAccountantAttention(ownerId: string, now = new Date()): Promise<ExceptionItem[]> {
  const items: ExceptionItem[] = [];
  const accountants = await prisma.user.findMany({
    where: { role: "ACCOUNTANT", archivedAt: null },
    select: { id: true, name: true, email: true, firm: true, accessEndsOn: true, createdAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  for (const user of accountants) {
    const kind = accessEndAttentionKind(user, now);
    if (!kind) continue;
    const label = `${user.name || user.email}${user.firm ? ` (${user.firm})` : ""}`;
    if (kind === "ending-soon") {
      items.push({
        category: "ACCOUNTANT",
        severity: "medium",
        title: `${label}'s access ends on ${businessDateKey(user.accessEndsOn!)}`,
        detail: "After that date they can't sign in. Extend the date, or remove them, from Settings › Team.",
        href: "/desk/settings",
        since: now,
      });
    } else if (kind === "ended") {
      items.push({
        category: "ACCOUNTANT",
        severity: "medium",
        title: `${label}'s access ended on ${businessDateKey(user.accessEndsOn!)}`,
        detail: "They can no longer sign in. Give them a new end date, or remove them, from Settings › Team.",
        href: "/desk/settings",
        since: user.accessEndsOn!,
      });
    } else {
      items.push({
        category: "ACCOUNTANT",
        severity: "low",
        title: `${label}'s accountant access has no end date`,
        detail: "It has been open for about six months. Check it still should be, or set an end date in Settings › Team.",
        href: "/desk/settings",
        since: now,
      });
    }
  }
  const unseen = await unseenAccountantChangeCount(ownerId).catch(() => 0);
  if (unseen > 0) {
    items.push({
      category: "ACCOUNTANT",
      severity: "low",
      title: `${unseen} change${unseen === 1 ? "" : "s"} by your accountant since you last looked`,
      detail: "See “Changes by your accountant” on the Books home page.",
      href: "/desk/books",
      since: now,
    });
  }
  return items;
}
