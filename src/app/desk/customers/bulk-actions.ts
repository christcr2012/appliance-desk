"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";

/**
 * Bulk "Export selected (CSV)": the kit bulk bar posts the selected row ids;
 * the answer is a redirect to the export route with exactly those ids, so
 * the download itself is the same OWNER/ADMIN CSV the header export serves.
 */
export async function exportSelectedCustomersAction(fd: FormData) {
  await requireRole("OWNER", "ADMIN");
  const ids = fd
    .getAll("id")
    .map((v) => String(v))
    .filter(Boolean)
    .slice(0, 500);
  if (ids.length === 0) return { error: "Select at least one customer first." };
  redirect(`/desk/customers/export?ids=${ids.map(encodeURIComponent).join(",")}`);
}
