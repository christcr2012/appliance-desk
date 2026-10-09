"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { OutOfServiceError, resolveOutOfService } from "@/domains/billing/out-of-service";
import { runHandoffsByIds } from "@/domains/jobs/completion";

export type ResolveState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

/** Same machine delivered back, or close the repair period without a replacement (W-21A). OWNER/ADMIN. */
export async function resolveOutOfServiceAction(
  applianceId: string,
  how: "SAME_MACHINE_BACK" | "CLOSED_BY_OWNER",
  dateKey: string,
): Promise<ResolveState> {
  const session = await requireRole("OWNER", "ADMIN");
  const on = businessDateFromKey(dateKey);
  if (!on) return { status: "error", message: "Choose the date." };
  try {
    const result = await resolveOutOfService(session.user.id, { applianceId, how, on });
    if (result.creditId) {
      const handoffs = await prisma.jobBillingHandoff.findMany({
        where: { jobId: result.startJobId, kind: "PUSH_CREDIT", subjectId: result.creditId },
        select: { id: true },
      });
      await runHandoffsByIds(handoffs.map((h) => h.id));
    }
    revalidatePath(`/desk/inventory/${applianceId}`);
    revalidatePath("/desk/today");
    return { status: "success", message: result.note };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof OutOfServiceError || (error instanceof Error && error.message.startsWith("This account"))
          ? error.message
          : "Nothing was saved. Reload the page and try again.",
    };
  }
}
