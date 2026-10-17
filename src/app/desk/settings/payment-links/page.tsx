import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { InfoTip } from "@/components/ui/info-tip";
import { PaymentLinkError, getTemplateOverrides, saveTemplate } from "@/domains/billing/payment-link";
import {
  DEFAULT_TEMPLATES, PAYMENT_LINK_REASONS, REASON_LABEL, TEMPLATE_PLACEHOLDERS, templateFor, type PaymentLinkReason,
} from "@/domains/billing/payment-link-message";

export const metadata = { title: "Payment link wording", robots: { index: false, follow: false } };

async function save(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const reason = String(form.get("reason") ?? "") as PaymentLinkReason;
  const restore = form.get("operation") === "restore";
  try {
    await saveTemplate(session.user.id, reason, restore ? null : String(form.get("text") ?? ""));
  } catch (error) {
    if (!(error instanceof PaymentLinkError)) throw error;
    // Show the plain-English problem on the page via the search string.
    const { redirect } = await import("next/navigation");
    redirect("/desk/settings/payment-links?problem=" + encodeURIComponent(error.message) + "&reason=" + encodeURIComponent(reason));
  }
  revalidatePath("/desk/settings/payment-links");
}

export default async function PaymentLinkWordingPage({ searchParams }: { searchParams: Promise<{ problem?: string; reason?: string }> }) {
  await requireRole("OWNER");
  const { problem, reason: problemReason } = await searchParams;
  const overrides = await getTemplateOverrides();
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Payment link wording</h1>
      <p className="text-sm text-ink-soft">
        The message that goes with a customer&apos;s secure payment page. There is one wording for each reason you can pick on an invoice.
        You always see the exact message, with the real amount and dates filled in, before anything is sent. Only the owner can change these.
        You can use these words in braces: {TEMPLATE_PLACEHOLDERS.map((p) => "{" + p + "}").join(" ")}. Keep {"{link}"} so the customer gets the payment page. <InfoTip term="payment-link-wording" />
      </p>
      {problem && <p role="alert" className="rounded-md border p-3 text-sm font-medium">{problem}{problemReason ? " (" + REASON_LABEL[problemReason as PaymentLinkReason] + ")" : ""}</p>}
      {PAYMENT_LINK_REASONS.map((reason) => (
        <form key={reason} action={save} className="space-y-3 rounded-md border p-4">
          <input type="hidden" name="reason" value={reason} />
          <label htmlFor={"text-" + reason} className="block font-medium">{REASON_LABEL[reason]}</label>
          <textarea id={"text-" + reason} name="text" rows={7} maxLength={1500} defaultValue={templateFor(reason, overrides)} className="w-full rounded-md border bg-surface p-2 text-sm" />
          <p className="text-xs text-ink-soft">{overrides?.[reason] ? "Using your wording." : "Using the recommended wording."}</p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="rounded-md border px-4 py-2 font-medium">Save</button>
            <button name="operation" value="restore" type="submit" formNoValidate className="rounded-md border px-4 py-2" disabled={!overrides?.[reason]}>Restore recommended wording</button>
          </div>
          <details className="text-xs text-ink-soft"><summary>See the recommended wording</summary><pre className="mt-2 whitespace-pre-wrap">{DEFAULT_TEMPLATES[reason]}</pre></details>
        </form>
      ))}
    </main>
  );
}
