"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { markSmsInboxRead, updateSmsThreadStatus, assignSmsThread } from "@/domains/messaging/inbox";

function str(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
export async function markThreadReadAction(form: FormData) {
  const actor = await requireRole("OWNER","ADMIN","STAFF");
  const id = str(form,"threadId");
  await markSmsInboxRead(actor.user.id,id,str(form,"messageId"));
  revalidatePath("/desk/communications/"+id);
  revalidatePath("/desk/communications");
}
export async function changeThreadStatusAction(form: FormData) {
  const actor = await requireRole("OWNER","ADMIN","STAFF");
  const id = str(form,"threadId");
  const status = str(form,"status");
  if (!["OPEN","WAITING","CLOSED"].includes(status)) throw new Error("Invalid thread status.");
  await updateSmsThreadStatus(actor.user.id,id,Number(str(form,"version")),
    status as "OPEN"|"WAITING"|"CLOSED");
  revalidatePath("/desk/communications/"+id);
  revalidatePath("/desk/communications");
}
export async function assignThreadAction(form: FormData) {
  const actor = await requireRole("OWNER","ADMIN");
  const id = str(form,"threadId");
  await assignSmsThread(actor.user.id,id,Number(str(form,"version")),
    str(form,"assignee") || null);
  revalidatePath("/desk/communications/"+id);
  revalidatePath("/desk/communications");
}
