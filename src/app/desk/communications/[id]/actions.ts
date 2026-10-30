"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { linkMessageContext } from "@/domains/messaging/context-links";
import { markSmsInboxRead, updateSmsThreadStatus, assignSmsThread } from "@/domains/messaging/inbox";
import { linkThreadIdentity, unlinkThreadIdentity } from "@/domains/messaging/thread-identity";

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
/** AR-4d: people search for the "Who is this?" sheet — customers and leads,
 * labelled by kind. Ids are prefixed so the panel can tell them apart. */
export async function searchPeopleAction(q: string) {
  await requireRole("OWNER", "ADMIN");
  const needle = q.trim();
  if (needle.length < 2) return [];
  const contains = { contains: needle, mode: "insensitive" as const };
  const [customers, leads] = await Promise.all([
    prisma.customer.findMany({
      where: {
        archivedAt: null,
        OR: [{ user: { name: contains } }, { companyName: contains }],
      },
      select: { id: true, companyName: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.lead.findMany({
      where: {
        mergedIntoLeadId: null,
        OR: [{ contactName: contains }, { companyName: contains }],
      },
      select: { id: true, contactName: true, companyName: true },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
  ]);
  return [
    ...customers.map((c) => ({
      id: `customer:${c.id}`,
      label: c.user.name ?? c.companyName ?? "Customer",
      detail: c.companyName && c.user.name ? `Customer · ${c.companyName}` : "Customer",
    })),
    ...leads.map((l) => ({
      id: `lead:${l.id}`,
      label: l.contactName,
      detail: l.companyName ? `Lead · ${l.companyName}` : "Lead",
    })),
  ];
}

export async function linkThreadIdentityAction(
  threadId: string,
  picked: string,
  version: number,
) {
  const actor = await requireRole("OWNER", "ADMIN");
  const sep = picked.indexOf(":");
  const kind = sep > 0 ? picked.slice(0, sep) : "";
  const id = sep > 0 ? picked.slice(sep + 1) : "";
  if (!id || (kind !== "customer" && kind !== "lead")) {
    throw new Error("Choose a person to link.");
  }
  await linkThreadIdentity(
    actor.user.id,
    threadId,
    kind === "customer" ? { customerId: id } : { leadId: id },
    version,
  );
  revalidatePath("/desk/communications/" + threadId);
  revalidatePath("/desk/communications");
}

export async function unlinkThreadIdentityAction(threadId: string) {
  const actor = await requireRole("OWNER", "ADMIN");
  await unlinkThreadIdentity(actor.user.id, threadId);
  revalidatePath("/desk/communications/" + threadId);
  revalidatePath("/desk/communications");
}

export async function linkMessageContextAction(form:FormData){
 const threadId=str(form,"threadId");
 const messageId=str(form,"messageId");
 const target=str(form,"target");
 const separator=target.indexOf(":");
 if(separator<1) throw new Error("Choose a linked record.");
 const kind=target.slice(0,separator);
 const entityId=target.slice(separator+1);
 if(!["Job","MaintenanceRequest","Invoice"].includes(kind)) throw new Error("Invalid context.");
 await linkMessageContext({threadId,messageId,
  kind:kind as "Job"|"MaintenanceRequest"|"Invoice",entityId});
 revalidatePath("/desk/communications/"+threadId);
 const prefix=kind==="Job"?"jobs":kind==="MaintenanceRequest"?"maintenance":null;
 if(prefix) revalidatePath("/desk/"+prefix+"/"+entityId);
}
