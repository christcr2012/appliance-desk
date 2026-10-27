"use server";
// FEE-1: mark a customer as active-duty military (optional, never required). Such a customer never gets an automatic late fee.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { assertActiveTeamActor } from "@/lib/team-actor";

export async function setActiveMilitaryAction(form: FormData): Promise<void> {
  const session = await requireRole("OWNER", "ADMIN");
  const customerId = form.get("customerId");
  if (typeof customerId !== "string" || !customerId || customerId.length > 200) return;
  const value = form.get("activeMilitary") === "on";
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, session.user.id, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const before = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { activeMilitary: true } });
    if (before.activeMilitary === value) return;
    await tx.customer.update({ where: { id: customerId }, data: { activeMilitary: value } });
    await tx.auditLog.create({
      data: { userId: session.user.id, action: "customer.active_military.update", entityType: "Customer", entityId: customerId, oldValue: { activeMilitary: before.activeMilitary }, newValue: { activeMilitary: value } },
    });
  });
  revalidatePath(`/desk/customers/${customerId}`);
  revalidatePath("/desk/today");
}
