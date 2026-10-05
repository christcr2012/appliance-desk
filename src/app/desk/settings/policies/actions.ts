"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { publishChecklistVersion } from "@/domains/inventory/checklist-versions";

export async function publishChecklistAction(formData: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const items = String(formData.get("items") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  await publishChecklistVersion(session.user.id, items);
  revalidatePath("/desk/settings/policies");
}
