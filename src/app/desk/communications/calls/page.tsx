import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listMissedCallInbox } from "@/domains/messaging/voice-media";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Missed calls and voicemail" };
export default async function MissedCallInbox({
  searchParams,
}: { searchParams: Promise<{ cursor?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { cursor } = await searchParams;
  const result = await listMissedCallInbox(session.user.id, cursor);
  return (
    <div className="space-y-6">
      <Link href="/desk/communications" className="underline">← Communications</Link>
      <PageHeader title="Calls & voicemail" description="Private call records. A missed or unknown call is not proof of a customer's identity. Voicemail capture remains OFF until independently approved." />
      <Card title="Calls requiring review" description="OWNER and ADMIN may review all calls. Team members see only calls from explicitly assigned threads.">
        {result.rows.length === 0 ? <p>No calls match this view.</p> : (
          <ul className="divide-y divide-line">
            {result.rows.map((call) => {
              const available = call.media.some((m) =>
                m.kind === "VOICEMAIL" && m.state === "AVAILABLE" && !m.deletedAt &&
                (m.legalHold || !m.retentionUntil || m.retentionUntil > new Date()));
              return (
                <li key={call.id}>
                  <Link className="block rounded p-3 hover:bg-surface-raised" href={"/desk/communications/calls/" + encodeURIComponent(call.id)}>
                    <span className="font-semibold">{call.outcome === "UNKNOWN" ? "Outcome needs review" :
                      call.outcome === "VOICEMAIL" ? "Voicemail" : "Missed call"}</span>
                    <span className="ml-3 text-sm text-ink-soft">{call.startedAt.toLocaleString()}</span>
                    <p className="text-sm text-ink-soft">{available ? "Private voicemail ready" : "No playable voicemail"} · {call.state}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {result.next && <Link href={"/desk/communications/calls?cursor=" + encodeURIComponent(result.next)}
          className="mt-4 inline-block underline">Older calls</Link>}
      </Card>
    </div>
  );
}
