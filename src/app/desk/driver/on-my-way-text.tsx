import { getWorkflowTextPreview } from "@/domains/messaging/workflow-text";
import { SendTextForm } from "@/app/desk/_text/send-text-form";

/**
 * AR-5 section 5: the "On my way" text on a route stop. Same rule as the
 * visit record's Messages tab (the page only renders this for a person who
 * may text this customer), and the exact-words form appears only when the
 * job_on_the_way preview is actually sendable — texting live, template
 * approved, a phone on file. Anything else renders nothing.
 */
export async function OnMyWayText({
  userId,
  jobId,
  customerId,
}: {
  userId: string;
  jobId: string;
  customerId?: string;
}) {
  let preview;
  try {
    preview = await getWorkflowTextPreview(userId, "job_on_the_way", jobId);
  } catch {
    return null;
  }
  if (!preview.ready) return null;
  return (
    <details className="rounded-card border border-line bg-white p-3">
      <summary className="cursor-pointer text-sm font-bold text-ink">On my way — text the customer</summary>
      <div className="mt-2">
        <SendTextForm preview={preview} subjectId={jobId} path="/desk/driver" principal={{ customerId }} />
      </div>
    </details>
  );
}
