"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";

export async function disconnectAssistant(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const id = String(form.get("id") ?? "");
  if (!id || id.length > 100) throw new Error("Choose a connection to disconnect.");
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, session.user.id, ["OWNER", "ADMIN"]);
    const changed = await tx.mcpConnection.updateMany({
      where: { id, userId: session.user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "Disconnected by user" },
    });
    if (changed.count !== 1) throw new Error("This assistant is already disconnected or no longer available.");
    await tx.auditLog.create({ data: {
      userId: session.user.id, action: "mcp.connection_disconnected", entityType: "McpConnection", entityId: id,
    } });
  });
  revalidatePath("/desk/automations");
}
