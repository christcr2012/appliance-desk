import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDateKey, businessEndOfDay } from "@/lib/business-date";
import { renewAgreement } from "@/domains/agreements/term";
import { decideEndingPickup } from "@/domains/agreements/pickup-draft";
import { getRentalEndReasons, parseEndReasonInput, recordAgreementEndReason } from "@/domains/agreements/end-reasons";
import { EndReasonFields } from "../end-reason-fields";

export const metadata = { title: "Rental ending", robots: { index: false, follow: false } };

async function decide(agreementId: string, choice: string, formData?: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const a = await prisma.rentalAgreement.findUnique({ where: { id: agreementId }, select: { termMonths: true, endDate: true } });
  if (!a?.endDate || !a.termMonths) throw new Error("This rental has no fixed end date.");
  if (choice === "pickup") {
    const { jobId } = await decideEndingPickup(session.user.id, agreementId);
    // AR-4a: the optional "Why is it ending?" answer rides along with pickup.
    const rawReason = formData?.get("endReason");
    if (typeof rawReason === "string" && rawReason.trim()) {
      const allowed = await getRentalEndReasons();
      const rawNote = formData?.get("endReasonNote");
      const input = parseEndReasonInput(rawReason, typeof rawNote === "string" ? rawNote : null, allowed);
      await recordAgreementEndReason(session.user.id, agreementId, input);
    }
    revalidatePath("/desk/today");
    redirect("/desk/jobs/" + encodeURIComponent(jobId));
  }
  if (choice !== "renew" && choice !== "month-to-month") throw new Error("Unknown choice.");
  const { newAgreementId } = await renewAgreement(session.user.id, agreementId, {
    termMonths: choice === "renew" ? a.termMonths : null,
    startOn: new Date(businessEndOfDay(a.endDate).getTime() + 1000),
  });
  revalidatePath("/desk/today");
  redirect("/desk/agreements/" + encodeURIComponent(newAgreementId));
}

export default async function EndingDecisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const a = await prisma.rentalAgreement.findUnique({
    where: { id }, select: { id: true, status: true, termMonths: true, endDate: true, terminationRequestedAt: true,
      customer: { select: { user: { select: { name: true, email: true } } } } },
  });
  if (!a) notFound();
  const endReasons = await getRentalEndReasons();
  const name = a.customer.user.name ?? a.customer.user.email;
  const fromEnd = (await searchParams).from === "end";
  const decidable = a.status === "ACTIVE" && a.termMonths && a.endDate && !a.terminationRequestedAt;
  return (
    <main className="mx-auto max-w-2xl space-y-5">
      {fromEnd && (
        <p className="rounded-lg border border-line bg-subtle p-3 text-sm" role="status">
          Ending {name}&apos;s rental — step 2 of 3{" "}
          <Link href={"/desk/agreements/" + encodeURIComponent(id)} className="font-medium underline">&larr; Back to the rental</Link>
        </p>
      )}
      <Link href={"/desk/agreements/" + encodeURIComponent(id)} className="text-sm underline">Back to the agreement</Link>
      <h1 className="text-xl font-semibold">{name}&apos;s rental is ending{a.endDate ? " on " + businessDateKey(a.endDate) : ""}</h1>
      {!decidable ? (
        <p className="text-sm">Nothing to decide here: this rental is not an active fixed-term rental, or an ending is already set.</p>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            Pick what happens next. None of these sends anything to the customer or charges anything. Renew and Month-to-month
            only start a draft you can review first. Pickup adds a draft pickup visit to your To do list for you to schedule.
          </p>
          <div className="grid gap-3">
            <form action={decide.bind(null, id, "renew")}><button className="w-full rounded-md border px-4 py-3 text-left font-medium">Renew for another {a.termMonths} months <span className="block text-sm font-normal text-ink-soft">Starts a draft renewal with the same machines and prices.</span></button></form>
            <form action={decide.bind(null, id, "month-to-month")}><button className="w-full rounded-md border px-4 py-3 text-left font-medium">Switch to month-to-month <span className="block text-sm font-normal text-ink-soft">Starts a draft month-to-month renewal.</span></button></form>
            <form action={decide.bind(null, id, "pickup")} className="rounded-md border px-4 py-3"><button className="w-full text-left font-medium">Pick up the machines <span className="block text-sm font-normal text-ink-soft">Creates one draft pickup visit. Repeating this never creates a second one.</span></button><EndReasonFields reasons={endReasons} /></form>
          </div>
        </>
      )}
    </main>
  );
}
