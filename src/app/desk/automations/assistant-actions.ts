"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";

/**
 * Disconnect is atomic with revoking every outstanding OAuth grant. A signed
 * access token is independently rejected by the connection check on each call.
 */
export async function disconnectAssistant(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const id = String(form.get("id") ?? "");
  if (!id || id.length > 100) throw new Error("Choose a connection to disconnect.");
  await prisma.$transaction(async (tx) => {
    const actor = await assertActiveTeamActor(tx, session.user.id, ["OWNER", "ADMIN"]);
    const connection = await tx.mcpConnection.findFirst({
      where: { id, ...(actor.role === "OWNER" ? {} : { userId: actor.id }) },
      select: { id: true, userId: true, oauthClientId: true, revokedAt: true },
    });
    if (!connection || connection.revokedAt) {
      throw new Error("This assistant is already disconnected or no longer available.");
    }
    const revokedAt = new Date();
    const changed = await tx.mcpConnection.updateMany({
      where: { id: connection.id, revokedAt: null },
      data: { revokedAt, revokedReason: "Disconnected by user" },
    });
    if (changed.count !== 1) {
      throw new Error("This assistant is already disconnected or no longer available.");
    }
    const grant = { userId: connection.userId, clientId: connection.oauthClientId, revoked: null };
    await tx.oauthRefreshToken.updateMany({ where: grant, data: { revoked: revokedAt } });
    await tx.oauthAccessToken.updateMany({ where: grant, data: { revoked: revokedAt } });
    await tx.oauthConsent.deleteMany({
      where: { userId: connection.userId, clientId: connection.oauthClientId },
    });
    await tx.auditLog.create({ data: {
      userId: actor.id, action: "mcp.connection_disconnected", entityType: "McpConnection", entityId: id,
    } });
  });
  revalidatePath("/desk/automations");
}
