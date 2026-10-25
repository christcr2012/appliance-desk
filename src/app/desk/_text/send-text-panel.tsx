import { getWorkflowTextHistory, getWorkflowTextPreview } from "@/domains/messaging/workflow-text";
import { SendTextForm } from "./send-text-form";

const STATE_WORDS: Record<string, string> = {
  PENDING: "Waiting to go out", ACCEPTED: "Handed to the carrier", DELIVERED: "Delivered", FAILED: "Did not go out",
  UNKNOWN: "Result unknown", NOT_SENT: "Not sent",
};

/** "Text this person" box for a lead, estimate or agreement screen. Shows the exact words before anything is sent. */
export async function SendTextPanel(props: {
  userId: string; entityType: "Lead" | "Estimate" | "RentalAgreement" | "Job" | "MaintenanceRequest"; entityId: string; path: string;
  families: string[]; principal: { leadId?: string; customerId?: string };
}) {
  const [previews, history] = await Promise.all([
    Promise.all(props.families.map((f) => getWorkflowTextPreview(props.userId, f, props.entityId))),
    getWorkflowTextHistory(props.userId, props.entityType, props.entityId),
  ]);
  return <section aria-labelledby={`text-${props.entityId}`} className="rounded-card border border-line p-4">
    <h2 id={`text-${props.entityId}`} className="text-lg font-semibold">Text message</h2>
    <p className="mt-1 text-sm text-ink-soft">Nothing is sent until you press Send. You see the exact words first.</p>
    <div className="mt-3 space-y-4">
      {previews.map((p) => <SendTextForm key={p.family} preview={p} subjectId={props.entityId} path={props.path}
        principal={props.principal} />)}
    </div>
    {history.length > 0 && <div className="mt-4">
      <h3 className="text-sm font-semibold">Texts about this</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {history.map((h, i) => <li key={i}>{h.label} · {STATE_WORDS[h.state] ?? h.state} ·{" "}
          {h.at.toLocaleString("en-US", { timeZone: "America/Denver" })}</li>)}
      </ul>
    </div>}
  </section>;
}
