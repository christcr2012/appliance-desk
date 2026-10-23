import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { isCapability, type Capability } from "@/domains/capabilities";
import { visibleOwnerActions, type OwnerAction } from "@/lib/owner-actions";
import {
  EMPTY_PREFERENCES, MAX_PINNED, MAX_SAVED_VIEWS, OPTIONAL_TODAY_CARDS, SAVED_VIEW_ROUTES, readPreferences, validatePreferences,
  type SavedView, type SavedViewRoute, type WorkspacePreferences,
} from "./preferences";

export * from "./preferences";

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export type Workspace = { version: number; prefs: WorkspacePreferences };

/** The signed-in person's own workspace. There is no way to ask for anyone else's: the only input is the actor. */
export async function getWorkspace(userId: string): Promise<Workspace> {
  const row = await prisma.ownerWorkspacePreference.findUnique({ where: { userId }, select: { version: true, preferences: true } });
  return row ? { version: row.version, prefs: readPreferences(row.preferences) } : { version: 1, prefs: { ...EMPTY_PREFERENCES } };
}

type Ctx = { visible: OwnerAction[] };

async function update(
  actorUserId: string,
  expectedVersion: number,
  change: (current: WorkspacePreferences, ctx: Ctx) => WorkspacePreferences,
): Promise<void> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new WorkspaceError("Reload the page and try again.");
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actor = await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    const role: string = actor.role;
    const limitedRows = role === "ADMIN" ? await tx.staffCapabilityOverride.findMany({ where: { userId: actorUserId, allowed: false }, take: 20 }) : [];
    const limited: Capability[] = limitedRows.map((r) => r.capability).filter(isCapability);
    const empty = JSON.stringify(EMPTY_PREFERENCES);
    await tx.$executeRaw`INSERT INTO "OwnerWorkspacePreference" ("userId","version","preferences","updatedAt") VALUES (${actorUserId}, 1, ${empty}::jsonb, now()) ON CONFLICT ("userId") DO NOTHING`;
    await tx.$queryRaw`SELECT "userId" FROM "OwnerWorkspacePreference" WHERE "userId" = ${actorUserId} FOR UPDATE`;
    const row = await tx.ownerWorkspacePreference.findUniqueOrThrow({ where: { userId: actorUserId } });
    if (row.version !== expectedVersion) throw new WorkspaceError("Your shortcuts were changed in another window. Reload the page and try again.");
    const next = validatePreferences(change(readPreferences(row.preferences), { visible: visibleOwnerActions(role, limited) }));
    if (!next.ok) throw new WorkspaceError(next.error);
    await tx.ownerWorkspacePreference.update({ where: { userId: actorUserId }, data: { preferences: next.value as unknown as Prisma.InputJsonValue, version: row.version + 1 } });
  });
}

export function pinAction(actorUserId: string, expectedVersion: number, actionId: string) {
  return update(actorUserId, expectedVersion, (p, { visible }) => {
    if (!visible.some((a) => a.id === actionId)) throw new WorkspaceError("That shortcut is not available to you.");
    if (p.pinnedActionIds.includes(actionId)) return p;
    if (p.pinnedActionIds.length >= MAX_PINNED) throw new WorkspaceError(`You can pin up to ${MAX_PINNED} shortcuts. Unpin one first.`);
    return { ...p, pinnedActionIds: [...p.pinnedActionIds, actionId] };
  });
}

export function unpinAction(actorUserId: string, expectedVersion: number, actionId: string) {
  return update(actorUserId, expectedVersion, (p) => ({ ...p, pinnedActionIds: p.pinnedActionIds.filter((id) => id !== actionId) }));
}

/** `hidden = true` hides an optional Today note; false shows it again. Important items cannot be hidden. */
export function setOptionalCardHidden(actorUserId: string, expectedVersion: number, cardId: string, hidden: boolean) {
  return update(actorUserId, expectedVersion, (p) => {
    if (!OPTIONAL_TODAY_CARDS.some((c) => c.id === cardId)) throw new WorkspaceError("Only the optional notes can be hidden. Important items always show.");
    const rest = p.hiddenOptionalCardIds.filter((id) => id !== cardId);
    return { ...p, hiddenOptionalCardIds: hidden ? [...rest, cardId] : rest };
  });
}

export function addSavedView(actorUserId: string, expectedVersion: number, input: { label: string; routeKey: string; filters: Record<string, string> }) {
  return update(actorUserId, expectedVersion, (p) => {
    if (!Object.hasOwn(SAVED_VIEW_ROUTES, input.routeKey)) throw new WorkspaceError("That screen cannot have saved views.");
    if (p.savedViews.length >= MAX_SAVED_VIEWS) throw new WorkspaceError(`You can save up to ${MAX_SAVED_VIEWS} views. Remove one first.`);
    const view: SavedView = { id: `v-${randomUUID().slice(0, 12)}`, label: input.label, routeKey: input.routeKey as SavedViewRoute, filters: input.filters };
    return { ...p, savedViews: [...p.savedViews, view] };
  });
}

/** Start over: no pins, no saved views, nothing hidden. The page shows what will go before the person presses the button. */
export function resetWorkspace(actorUserId: string, expectedVersion: number) {
  return update(actorUserId, expectedVersion, () => ({ ...EMPTY_PREFERENCES }));
}

export function removeSavedView(actorUserId: string, expectedVersion: number, viewId: string) {
  return update(actorUserId, expectedVersion, (p) => ({ ...p, savedViews: p.savedViews.filter((v) => v.id !== viewId) }));
}
