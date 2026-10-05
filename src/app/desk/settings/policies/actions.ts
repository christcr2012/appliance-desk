"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { publishChecklistVersion } from "@/domains/inventory/checklist-versions";
import {
  approveLegalPage,
  type LegalPage,
} from "@/domains/settings/legal-approvals";

export async function publishChecklistAction(formData: FormData) {
  const session = await requireRole("OWNER", "ADMIN");
  const items = String(formData.get("items") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  await publishChecklistVersion(session.user.id, items);
  revalidatePath("/desk/settings/policies");
}

export async function approveLegalPageAction(formData: FormData) {
  const session = await requireRole("OWNER");
  const rawPage = String(formData.get("page") ?? "");
  if (rawPage !== "privacy" && rawPage !== "terms") {
    throw new Error("Unknown legal page.");
  }
  await approveLegalPage(session.user.id, rawPage as LegalPage);
  revalidatePath("/desk/settings/policies");
  revalidatePath(`/${rawPage}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/", "layout");
}
