import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getSmsInboxThread } from "@/domains/messaging/inbox";
import { Card, PageHeader } from "@/components/ui";
import { markThreadReadAction, changeThreadStatusAction, assignThreadAction } from "./actions";

export const metadata = { title: "SMS conversation" };
export default async function SmsConversation({
  params,
}: { params: Promise<{id:string}> }) {
  const session = await requireRole("OWNER","ADMIN","STAFF");
  const { id } = await params;
  const thread = await getSmsInboxThread(session.user.id,id);
  const isOwnerAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const staff = isOwnerAdmin ? await prisma.user.findMany({
    where: { role: { in: ["OWNER","ADMIN","STAFF"] }, archivedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { email: "asc" }, take: 100,
  }) : [];

  return (
    <div className="space-y-6">
      <Link href="/desk/communications" className="underline">← All conversations</Link>
      <PageHeader title="SMS conversation" description={thread.resolution === "RESOLVED" ? "Verified contact context; still check purpose-specific permission before messaging." : "Identity is unresolved or shared. Never assume this number belongs to one customer."} />
      <Card title="Review and ownership">
        <dl className="text-sm">
          <dt>Identity</dt><dd>{thread.resolution}</dd>
          <dt>Workflow</dt><dd>{thread.status}</dd>
          <dt>Assigned</dt><dd>{thread.assignedUserId ? "Team member" : "Unassigned"}</dd>
        </dl>
        <form action={changeThreadStatusAction} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="threadId" value={id} />
          <input type="hidden" name="version" value={thread.version} />
          <label>Next status
            <select name="status" defaultValue={thread.status} className="ml-2 rounded border border-line bg-surface p-2">
              {(["OPEN","WAITING","CLOSED"] as const).map(s=><option value={s} key={s}>{s}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded bg-primary px-4 text-white">Save status</button>
        </form>
        {isOwnerAdmin && (
          <form action={assignThreadAction} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="threadId" value={id} />
            <input type="hidden" name="version" value={thread.version} />
            <label>Assign
              <select name="assignee" defaultValue={thread.assignedUserId ?? ""} className="ml-2 rounded border border-line bg-surface p-2">
                <option value="">Unassigned</option>
                {staff.map(s=><option key={s.id} value={s.id}>{s.name || s.email}</option>)}
              </select>
            </label>
            <button type="submit" className="min-h-11 rounded bg-primary px-4 text-white">Save assignee</button>
          </form>
        )}
      </Card>
      <Card title="Messages" description="Only authorized staff can view message bodies. Redacted or unavailable content stays hidden.">
        {thread.messages.length === 0 ? <p>No messages recorded.</p> : (
          <ol className="space-y-4">
            {thread.messages.map(msg=>(
              <li key={msg.id} className="rounded border border-line p-3">
                <p className="text-sm font-semibold">{msg.direction} · {msg.occurredAt.toLocaleString()}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{msg.text}</p>
                {msg.delivery && <p className="text-xs text-ink-soft">Delivery: {msg.delivery.state}</p>}
              </li>
            ))}
          </ol>
        )}
        {thread.messages.length > 0 && (
          <form action={markThreadReadAction} className="mt-4">
            <input type="hidden" name="threadId" value={id} />
            <input type="hidden" name="messageId" value={thread.messages[thread.messages.length-1].id} />
            <button type="submit" className="min-h-11 rounded bg-primary px-4 text-white">Mark reviewed through latest shown message</button>
          </form>
        )}
      </Card>
      <p className="text-sm text-ink-soft">
        Reply sending is intentionally unavailable until the approved sender,
        customer identity, scoped consent and context checks have been completed.
      </p>
    </div>
  );
}
