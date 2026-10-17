import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { createPickupVisitForAgreement } from "@/domains/agreements/pickup-draft";
import { agreementNeedsPickup } from "@/domains/agreements/pickup-needed";

/** Shown only when this rental is over or ending, appliances are still at the customer's and no pickup visit exists. */
export async function PickupVisitPanel({ agreementId }: { agreementId: string }) {
  if (!(await agreementNeedsPickup(agreementId, new Date()))) return null;
  async function create() {
    "use server";
    const session = await requireRole("OWNER", "ADMIN");
    const result = await createPickupVisitForAgreement(session.user.id, agreementId);
    redirect(`/desk/jobs/${result.jobId}`);
  }
  return (
    <section aria-labelledby="pickup-needed-heading" className="mt-6 rounded-lg border border-border p-4">
      <h2 id="pickup-needed-heading" className="font-semibold">Appliances still need to be picked up</h2>
      <p className="mt-1 text-sm text-ink-soft">This rental is over or ending and some appliances are still at the customer&apos;s. This makes a draft pickup visit for you to give a date and a technician. Nothing is sent to the customer.</p>
      <form action={create} className="mt-3">
        <button type="submit" className="rounded-md border border-border px-4 py-2 font-medium">Schedule the pickup</button>
      </form>
    </section>
  );
}
