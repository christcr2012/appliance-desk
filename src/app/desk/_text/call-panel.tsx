import { getClickToCallPreview, type CallSubject } from "@/domains/messaging/click-to-call";
import { CallForm } from "./call-form";

/** "Call from the desk" box. Hidden entirely until the Owner turns the feature on. */
export async function CallPanel(props: { userId: string; subject: CallSubject; path: string }) {
  const preview = await getClickToCallPreview(props.userId, props.subject);
  if (!preview.available && preview.reason.startsWith("Calling from the desk is switched off")) return null;
  return <section aria-labelledby={`call-${props.subject.id}`} className="rounded-card border border-line p-4">
    <h2 id={`call-${props.subject.id}`} className="text-lg font-semibold">Call</h2>
    {preview.available
      ? <CallForm type={props.subject.type} subjectId={props.subject.id} path={props.path} customerName={preview.customerName}
          customerPhone={preview.customerPhoneMasked} staffPhone={preview.staffPhoneMasked} businessNumber={preview.businessNumberMasked} />
      : <p className="mt-1 text-sm text-ink-soft">{preview.reason}</p>}
  </section>;
}
