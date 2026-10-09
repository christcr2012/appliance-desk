import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listSmsInbox } from "@/domains/messaging/inbox";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Communications inbox" };
type Search = { status?: string; resolution?: string; assignment?: string; cursor?: string };
const statuses = ["OPEN","WAITING","CLOSED"] as const;
const resolutions = ["RESOLVED","UNRESOLVED","AMBIGUOUS"] as const;
const assignments = ["all","mine","unassigned"] as const;

export default async function CommunicationsInbox({
  searchParams,
}: { searchParams: Promise<Search> }) {
  const session = await requireRole("OWNER","ADMIN","STAFF");
  const raw = await searchParams;
  const status = statuses.find(v => v === raw.status);
  const resolution = resolutions.find(v => v === raw.resolution);
  const assignment = assignments.find(v => v === raw.assignment) ?? "all";
  const page = await listSmsInbox(session.user.id, { status, resolution, assignment }, raw.cursor);
  const next = new URLSearchParams();
  if (status) next.set("status",status);
  if (resolution) next.set("resolution",resolution);
  if (assignment !== "all") next.set("assignment",assignment);
  if (page.next) next.set("cursor",page.next);

  return (
    <div className="space-y-6">
      <PageHeader title="Communications" description="Private SMS inbox. Unresolved numbers are not verified customer identities. Sending stays off until separately approved." />
      <Card title="Find conversations" description="Staff see only threads assigned to them.">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Status
            <select name="status" defaultValue={status ?? ""} className="ml-2 rounded border border-line bg-surface p-2">
              <option value="">All</option>
              {statuses.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="text-sm">Identity
            <select name="resolution" defaultValue={resolution ?? ""} className="ml-2 rounded border border-line bg-surface p-2">
              <option value="">All</option>
              {resolutions.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="text-sm">Assignment
            <select name="assignment" defaultValue={assignment} className="ml-2 rounded border border-line bg-surface p-2">
              {assignments.map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-11 rounded bg-primary px-4 text-white">Filter</button>
        </form>
      </Card>
      <Card title="SMS threads" description="Open a thread to review its private messages and move it through the workflow.">
        {page.rows.length === 0 ? <p>No conversations match these filters.</p> : (
          <ul className="divide-y divide-line">
            {page.rows.map(row=>(
              <li key={row.id} className="py-3">
                <Link href={"/desk/communications/"+encodeURIComponent(row.id)} className="block rounded p-2 hover:bg-surface-raised">
                  <span className="font-semibold">{row.unread ? "Unread · " : ""}{row.resolution}</span>
                  <span className="ml-3 text-sm text-ink-soft">{row.status} · {row.assignedUserId ? "Assigned" : "Unassigned"}</span>
                  <p className="text-xs text-ink-soft">Last activity {row.lastActivityAt.toLocaleString()}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {page.next && <Link href={"/desk/communications?"+next.toString()} className="mt-4 inline-block underline">Older conversations</Link>}
      </Card>
    </div>
  );
}
