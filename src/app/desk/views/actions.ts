"use server";
// AR-12: the list's own Save action stores an allowlisted *filter*, never a free-form URL or another actor's views.
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { addSavedView, getWorkspace, WorkspaceError } from "@/domains/workspace";

type ListViewKind = "billing" | "customers";
const PERMITTED: Record<ListViewKind, readonly string[]> = {
  billing: ["status", "due", "autopay"],
  customers: ["status", "kind"],
};
export async function saveListView(kind: ListViewKind, form: FormData): Promise<{ error?: string; success?: string }> {
  const session = await requireRole("OWNER", "ADMIN");
  const label = String(form.get("label") ?? "");
  let supplied: unknown;
  try { supplied = JSON.parse(String(form.get("filters") ?? "{}")); }
  catch { return { error: "Choose one or more filters to save." }; }
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return { error: "Choose one or more filters to save." };
  const input = supplied as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(k => !PERMITTED[kind].includes(k) || typeof input[k] !== "string")) {
    return { error: "Only this screen's supported filters can be saved." };
  }
  try {
    const workspace = await getWorkspace(session.user.id);
    await addSavedView(session.user.id, workspace.version, { label, routeKey:kind, filters:input as Record<string,string> });
    revalidatePath("/desk/" + kind);
    revalidatePath("/desk/control-center");
    return { success: "Saved view" };
  } catch (error) {
    if (error instanceof WorkspaceError) return { error: error.message };
    throw error;
  }
}
export async function saveBillViewAction(form: FormData) { return saveListView("billing",form); }
export async function saveCustomerViewAction(form: FormData) { return saveListView("customers",form); }
