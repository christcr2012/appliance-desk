"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { updateMaintenanceStatus } from "@/domains/maintenance";
import type { MaintenanceStatus } from "@prisma/client";

export type MaintenanceActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const ALL_STATUSES: MaintenanceStatus[] = [
  "SUBMITTED",
  "REVIEWING",
  "SCHEDULED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
];

export async function updateMaintenanceStatusAction(
  requestId: string,
  status: string,
): Promise<MaintenanceActionState> {
  const session = await requireRole("OWNER", "ADMIN");

  if (!ALL_STATUSES.includes(status as MaintenanceStatus)) {
    return { status: "error", message: "That's not a valid status." };
  }

  try {
    await updateMaintenanceStatus(session.user.id, requestId, status as MaintenanceStatus);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Couldn't update that request.",
    };
  }

  revalidatePath("/desk/maintenance");
  revalidatePath(`/desk/maintenance/${requestId}`);
  revalidatePath("/desk/dashboard");
  revalidatePath("/desk/activity");
  return { status: "success" };
}
