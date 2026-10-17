import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { markCleaningDone } from "@/domains/inventory/cleaning";

/** Shown only while the appliance is being cleaned after a passed inspection. */
export function CleaningPanel({ applianceId, status }: { applianceId: string; status: string }) {
  if (status !== "CLEANING") return null;
  async function done() {
    "use server";
    const session = await requireRole("OWNER", "ADMIN");
    await markCleaningDone(session.user.id, applianceId);
    redirect(`/desk/inventory/${applianceId}`);
  }
  return (
    <section aria-labelledby="cleaning-heading" className="rounded-lg border border-line bg-white p-5">
      <h2 id="cleaning-heading" className="font-medium text-ink">This appliance is being cleaned</h2>
      <p className="mt-1 text-sm text-ink-soft">It passed inspection. It can&apos;t be rented again until you say the cleaning is finished.</p>
      <form action={done} className="mt-3">
        <button type="submit" className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium">Cleaning done</button>
      </form>
    </section>
  );
}
