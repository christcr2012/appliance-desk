import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { prisma } from "@/lib/prisma";
import { Card, PageHeader } from "@/components/ui";
import { formatBusinessDate } from "@/lib/business-date";
import { getCase } from "@/domains/collections/reads";
import { pickupGate } from "@/domains/collections/rules";
import { gatherSmallClaimsFacts, COURT_FORM_NAME } from "@/domains/collections/packet";
import { consentAction, courtOrderAction, decisionAction, filingAction, objectedAction, pickupAction } from "../actions";
import { CourtOrderForm, FilingForm, NoteAction } from "../controls";

export const metadata = { title: "Past-due account" };

export default async function CollectionCasePage({ params, searchParams }: { params: Promise<{ agreementId: string }>; searchParams: Promise<{ county?: string }> }) {
  await requireRole("OWNER", "ADMIN");
  const { agreementId } = await params;
  const county = ((await searchParams).county ?? "").trim().slice(0, 80) || null;
  const id = decodeURIComponent(agreementId);
  const kase = await getCase(id);
  if (!kase) notFound();
  const [steps, facts] = await Promise.all([
    prisma.collectionStep.findMany({ where: { invoice: { agreementId: id } }, orderBy: { cameUpOn: "asc" }, select: { id: true, kind: true, state: true, note: true, amountOwedCents: true, cameUpOn: true, invoice: { select: { invoiceNumber: true } } } }),
    gatherSmallClaimsFacts(id, county),
  ]);
  const decision = steps.find((s) => s.kind === "DECISION" && s.state === "WAITING");
  const gate = pickupGate({ consentAt: kase.pickupConsentAt, activeDuty: kase.customer.activeMilitary, courtOrderOn: kase.courtOrderOn });
  const name = kase.customer.user.name ?? "Customer";
  return (
    <div className="space-y-6">
      <Link href="/desk/collections" className="text-sm text-ink-soft hover:underline">&larr; Back to past-due follow-up</Link>
      <PageHeader title={`${name} — ${formatMoney(facts.owedCents)} owed`} />
      <Card title="What has happened">
        <ul className="space-y-1 text-sm">
          {steps.map((s) => <li key={s.id}>Bill #{s.invoice.invoiceNumber}: {s.kind.replace("_", " ").toLowerCase()} — {s.state.toLowerCase()}{s.note ? ` (${s.note})` : ""} · {formatBusinessDate(s.cameUpOn)}</li>)}
        </ul>
      </Card>
      {decision && (
        <Card title="Your decision">
          <p className="text-sm text-ink-soft">Choose one. Nothing is sent or picked up by this choice alone.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <NoteAction label="We agreed a payment plan" noteLabel="The plan (amounts and dates)" needsNote secondary run={decisionAction.bind(null, decision.id, id, "PAYMENT_PLAN")} />
            <NoteAction label="Take it to small claims" secondary run={decisionAction.bind(null, decision.id, id, "SMALL_CLAIMS", )} />
            <NoteAction label="Plan a pickup" secondary run={decisionAction.bind(null, decision.id, id, "PICKUP")} />
            <NoteAction label="Wait a while longer" noteLabel="Until when, and why" secondary run={decisionAction.bind(null, decision.id, id, "WAIT")} />
          </div>
        </Card>
      )}
      <Card title="Pickup after missed payments">
        {kase.customer.activeMilitary && <p className="mb-3 text-sm font-semibold">This customer is marked as on active military duty. Their appliance can&apos;t be taken back after a missed payment without a court order.</p>}
        <p className="text-sm text-ink-soft">A pickup visit can be made only after the customer has agreed to it{kase.customer.activeMilitary ? " and a court order is recorded" : ""}. If they don&apos;t agree, ask the court (replevin).</p>
        <dl className="mt-3 grid gap-1 text-sm">
          <div><dt className="inline font-semibold">Customer agreed: </dt><dd className="inline">{kase.pickupConsentAt ? `${formatBusinessDate(kase.pickupConsentAt)} — ${kase.pickupConsentHow}` : "Not recorded"}</dd></div>
          <div><dt className="inline font-semibold">Court order: </dt><dd className="inline">{kase.courtOrderOn ? `${formatBusinessDate(kase.courtOrderOn)} — ${kase.courtOrderNote}` : "None recorded"}</dd></div>
        </dl>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {!kase.pickupConsentAt && <NoteAction label="Record that they agreed" noteLabel="How they agreed (call, text, in person)" needsNote secondary run={consentAction.bind(null, id)} />}
          {!kase.courtOrderOn && <CourtOrderForm run={courtOrderAction.bind(null, id)} />}
        </div>
        <div className="mt-4 space-y-2">
          {gate.ok
            ? (kase.pickupJobId ? <p className="text-sm">A pickup visit exists. <Link className="font-semibold underline" href={`/desk/jobs/${kase.pickupJobId}`}>Open it</Link>.</p> : <NoteAction label="Make the pickup visit" run={pickupAction.bind(null, id)} />)
            : <p role="status" className="text-sm font-medium">{gate.message}</p>}
          {kase.pickupJobId && !kase.objectedAt && <NoteAction label="Customer objected — end the visit" noteLabel="What happened" secondary run={objectedAction.bind(null, id)} />}
          {kase.objectedAt && <p className="text-sm">The customer objected on {formatBusinessDate(kase.objectedAt)}; nothing was taken.</p>}
        </div>
      </Card>
      <Card title="Small claims">
        <p className="text-sm text-ink-soft">The app builds the packet; you file it yourself with the court. Limit {formatMoney(facts.limitCents)}; filing fee {formatMoney(facts.feeCents)} for this amount. The court allows 2 small-claims cases a month and 18 a year in one county.</p>
        {!facts.eligible.ok && facts.eligible.reason && <p role="status" className="mt-2 text-sm font-medium">{facts.eligible.reason}</p>}
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1 font-medium">Which county will you file in?
            <input name="county" defaultValue={county ?? ""} maxLength={80} className="min-h-11 rounded-control border border-line p-2" />
          </label>
          <button type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Check the limit</button>
        </form>
        <p className="mt-3 text-sm"><a className="font-semibold underline" href={`/desk/collections/${id}/packet${county ? `?county=${encodeURIComponent(county)}` : ""}`} target="_blank" rel="noopener noreferrer">Open the packet (PDF)</a> — then fill in {COURT_FORM_NAME} from the court&apos;s site.</p>
        <div className="mt-4"><FilingForm defaultAmount={moneyInputValue(facts.owedCents)} defaultFee={moneyInputValue(facts.feeCents)} run={filingAction.bind(null, id)} /></div>
      </Card>
    </div>
  );
}
