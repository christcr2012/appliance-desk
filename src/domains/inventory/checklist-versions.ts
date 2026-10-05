import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { checklistHash } from "./guided-actions";

/**
 * The return-inspection checklist only ever gains versions (docs/designs/BATCH-D.md D7). Publishing never changes a past
 * inspection: each one keeps the exact questions it was answered against.
 */

export const CHECKLIST_MAX_ITEMS = 40;
export const CHECKLIST_ITEM_MIN = 2;
export const CHECKLIST_ITEM_MAX = 200;

export type ChecklistCheck = { ok: true; items: string[] } | { ok: false; message: string };

/** Trim, drop empty lines and repeats (ignoring capitals), and check the limits. Pure. */
export function cleanChecklistItems(raw: unknown): ChecklistCheck {
  if (!Array.isArray(raw)) return { ok: false, message: "The checklist could not be read." };
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return { ok: false, message: "Every checklist item must be text." };
    const item = entry.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.length < CHECKLIST_ITEM_MIN || item.length > CHECKLIST_ITEM_MAX) {
      return { ok: false, message: `Each item must be between ${CHECKLIST_ITEM_MIN} and ${CHECKLIST_ITEM_MAX} characters: "${item.slice(0, 40)}"` };
    }
    items.push(item);
  }
  if (items.length < 1) return { ok: false, message: "A checklist needs at least one item." };
  if (items.length > CHECKLIST_MAX_ITEMS) return { ok: false, message: `A checklist can have at most ${CHECKLIST_MAX_ITEMS} items.` };
  return { ok: true, items };
}

export const CHECKLIST_STALE_MESSAGE = "Someone published a newer checklist while you were editing. Reload to see it.";

export async function publishChecklistVersion(
  userId: string,
  rawItems: readonly string[],
  options: { expectedCurrentVersion?: number } = {},
): Promise<{ versionId: string; version: number }> {
  const cleaned = cleanChecklistItems(rawItems);
  if (!cleaned.ok) throw new Error(cleaned.message);
  const items = cleaned.items;
  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    // Lock the newest version so two publishes cannot both become the same number.
    const top = await tx.$queryRaw<{ id: string; version: number; hash: string }[]>`
      SELECT "id", "version", "hash" FROM "InspectionChecklistVersion" ORDER BY "version" DESC LIMIT 1 FOR UPDATE
    `;
    const current = top[0] ?? null;
    if (options.expectedCurrentVersion !== undefined && (current?.version ?? 0) !== options.expectedCurrentVersion) {
      throw new Error(CHECKLIST_STALE_MESSAGE);
    }
    const hash = checklistHash(items);
    if (current && current.hash === hash) throw new Error("That is the same checklist as the current version, so nothing was published.");
    const version = (current?.version ?? 0) + 1;
    const created = await tx.inspectionChecklistVersion.create({
      data: { version, items, hash, publishedByUserId: userId },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "inspection.checklist_published",
        entityType: "InspectionChecklistVersion",
        entityId: created.id,
        newValue: { version, itemCount: items.length },
      },
    });
    return { versionId: created.id, version };
  });
}

export async function listChecklistVersions(take = 20) {
  const rows = await prisma.inspectionChecklistVersion.findMany({ orderBy: { version: "desc" }, take });
  const userIds = [...new Set(rows.map((r) => r.publishedByUserId).filter((v): v is string => !!v))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    items: Array.isArray(r.items) ? (r.items as unknown[]).filter((i): i is string => typeof i === "string") : [],
    publishedAt: r.publishedAt,
    publishedBy: r.publishedByUserId ? (names.get(r.publishedByUserId) ?? null) : null,
  }));
}
