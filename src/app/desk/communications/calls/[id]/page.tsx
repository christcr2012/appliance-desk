import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getPrivateCallMetadata } from "@/domains/messaging/voice-media";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Private call detail" };
export default async function CallDetail({ params }: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  let call: Awaited<ReturnType<typeof getPrivateCallMetadata>>;
  try { call = await getPrivateCallMetadata(actor.user.id, id); }
  catch { notFound(); }
  return (
    <div className="space-y-6">
      <Link href="/desk/communications/calls" className="underline">← Calls & voicemail</Link>
      <PageHeader title="Call review" description="Caller identity is unverified. Carrier answer is not evidence that a team member accepted the call." />
      <Card title="Call outcome">
        <dl className="grid gap-2 text-sm">
          <dt>Result</dt><dd className="font-semibold">{call.outcome ?? "Pending"}</dd>
          <dt>Started</dt><dd>{call.startedAt.toLocaleString()}</dd>
          <dt>Ended</dt><dd>{call.endedAt?.toLocaleString() ?? "Not confirmed"}</dd>
        </dl>
        <ol className="mt-4 space-y-2">
          {call.legs.map((leg) => (
            <li key={leg.id} className="rounded border border-line p-2 text-sm">
              {leg.role === "INBOUND" ? "Inbound caller" : "Forwarded destination"} · {leg.status}
              {leg.durationSeconds !== null ? " · " + leg.durationSeconds + "s" : ""}
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Private voicemail" description="Only a successfully imported, approved private message is playable; provider processing alone is not playable audio.">
        {call.media.length === 0 ? <p>No voicemail is available for this call.</p> :
          <ul className="space-y-4">
            {call.media.filter((m) => m.kind === "VOICEMAIL").map((m) => {
              const expired = !m.legalHold && !!m.retentionUntil && m.retentionUntil <= new Date();
              const ready = m.state === "AVAILABLE" && !m.deletedAt && !expired;
              return (
                <li key={m.id} className="rounded border border-line p-3 text-sm">
                  <p className="font-semibold">{ready ? "Voicemail ready" :
                    expired ? "Retention review due" : m.state === "FAILED" ? "Import needs review" : "No playable message"}</p>
                  <p className="text-ink-soft">Retention: {m.retentionUntil?.toLocaleDateString() ?? "Not set"}
                    {m.legalHold ? " · Legal hold" : ""}</p>
                  {ready && <audio controls preload="none" className="mt-3 w-full"
                    aria-label="Play private voicemail" src={"/api/communications/media/" + encodeURIComponent(m.id)} />}
                </li>
              );
            })}
          </ul>}
      </Card>
    </div>
  );
}
