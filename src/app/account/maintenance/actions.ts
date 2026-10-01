"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { createMaintenanceRequestForUser } from "@/domains/portal";

export type MaintenanceRequestActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const newRequestSchema = z.object({
  problem: z.string().trim().min(1, "Describe the problem.").max(2000)
    .refine((value) => value.replace(/^pickup request:\s*/i, "").trim().length > 0,
      "Please describe your request, including pickup details if applicable."),
  applianceId: z.string().trim().optional().or(z.literal("")),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  // Blob URLs already uploaded client-side via PhotoUploadField — see
  // src/app/api/uploads/photo/route.ts. Not a free-text URL a customer
  // types in, so no "must start with https://" validation is needed the
  // way the staff-facing photo actions have — but a max length and a
  // small cap on how many keeps one bad request from writing garbage.
  photoUrls: z.array(z.string().trim().url()).max(6).optional(),
});

/** The customer's own submission — requireSession only (any signed-in
 * user), never requireRole, since this is the customer-facing action.
 * The customer's identity comes entirely from their own session, never
 * from anything the client sends — see createMaintenanceRequestForUser. */
export async function createMaintenanceRequestAction(
  raw: Record<string, unknown>,
): Promise<MaintenanceRequestActionState> {
  const session = await requireSession();

  const parsed = newRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please fix the highlighted fields.",
    };
  }
  const data = parsed.data;

  try {
    await createMaintenanceRequestForUser(session.user.id, {
      problem: data.problem,
      applianceId: data.applianceId || null,
      priority: data.priority,
      photoUrls: data.photoUrls,
    });
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Couldn't submit that request.",
    };
  }

  revalidatePath("/account/maintenance");
  revalidatePath("/account");
  revalidatePath("/desk/maintenance");
  return { status: "success" };
}
