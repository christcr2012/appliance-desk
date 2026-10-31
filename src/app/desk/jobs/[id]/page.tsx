import { NoteAction } from "@/app/desk/collections/controls";
import { objectedAction } from "@/app/desk/collections/actions";
import { ContextCommunicationPanel } from "@/components/desk/context-communication-panel";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { CallPanel } from "@/app/desk/_text/call-panel";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDeskJobById } from "@/domains/desk-access";
import { getJobLocationPrivacy } from "@/domains/customers/location-contacts";
import { JobDetailPanel } from "./job-detail-panel";
import { JobSchedulePanel } from "./job-schedule-panel";
import { W24JobFeePanel } from "./w24-fee-panel";
import { prisma } from "@/lib/prisma";
import { JobPartsUsed } from "./job-parts-used";
import { getJobPartsUsed } from "@/domains/purchasing";
import { getAllPartRecords } from "@/domains/inventory";
import { getAssignableTeamMembers } from "@/domains/staff";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { getJobCompletionScope } from "@/domains/jobs";
import { pendingDeliveriesForJob } from "@/domains/billing/pickup-billing-events";
import { substituteChoices } from "@/domains/jobs/substitution";
import { businessDateKey } from "@/lib/business-date";
import { jobKindLabel, rentalAgreementStatusLabel } from "@/lib/status-labels";
import { LateReturnWaiverForm } from "./late-return-waiver-form";
import { getLateReturnWaiverState } from "@/domains/billing/late-return-waiver";
import { RecordConnections } from "@/components/desk/record-connections";
import { SafetyIncidentButton } from "@/components/desk/safety-incident-button";
import { ActionBar, RecordHeader, StatStrip, Timeline, Toaster } from "@/components/kit";
import { ButtonLink } from "@/components/ui";
import { visitPill, visitWhen } from "@/domains/jobs/words";
import { visitNextStep } from "@/domains/jobs/next-step";
import { getVisitTimeline } from "@/domains/jobs/timeline";

export const metadata = { title: "Visit" };

/** An instant as the Colorado clock reading a date-time box expects (YYYY-MM-DDTHH:mm). */
function denverLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function assignedLabel(id: string | null, team: Array<{ id: string; name: string | null; email: string }>): string | null {
  if (!id) return null;
  const member = team.find((m) => m.id === id);
  return member ? (member.name ?? member.email) : "Assigned";
}

type VisitTab = "visit" | "messages" | "activity";

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canViewFinance = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { id } = await params;
  const query = await searchParams;
  const tab: VisitTab = query.tab === "messages" || query.tab === "activity" ? query.tab : "visit";
  const fromBoard = query.from === "board";
  const job = await getDeskJobById(id);

  if (!job) {
    notFound();
  }
  const now = new Date();
  const [privateLocation] = await Promise.all([
    getJobLocationPrivacy({ userId: session.user.id, role: session.user.role }, job.id),
  ]);
  const showParts = canViewFinance && job.type === "MAINTENANCE_VISIT";
  const [teamMembers, partsUsed, partOptions, completionScope, pendingDeliveries] = await Promise.all([
    canViewFinance ? getAssignableTeamMembers() : Promise.resolve([]),
    showParts ? getJobPartsUsed(job.id) : Promise.resolve(null),
    showParts ? getAllPartRecords() : Promise.resolve([]),
    getJobCompletionScope({ id: job.id, type: job.type, status: job.status, agreementId: job.agreementId }),
    pendingDeliveriesForJob(job.id),
  ]);

  // AR-5 section 6: the owner-only follow-up reads run as one parallel block (they used to run
  // one after another), together with the next step's facts and, on the Activity tab, the timeline.
  const [ownerBlock, openFollowUps, timeline] = await Promise.all([
    (async () => {
      const feeData = session.user.role === "OWNER" && job.type === "DELIVERY" && !job.customerPickupHandoff
        ? await prisma.job.findUnique({ where: { id: job.id }, select: {
          type: true, status: true, version: true, noShowAt: true, noShowEvidence: true,
          approvedTripFeeCents: true, approvedRelocationFeeCents: true,
        } }) : null;
      const [feePolicy, providerFees] = feeData
        ? await Promise.all([
            prisma.businessSettings.findUnique({
              where: { id: "singleton" },
              select: { missedTripFeeCents: true, relocationFeeCents: true },
            }),
            prisma.providerOperation.findMany({
              where: { subjectType: "Job", subjectId: job.id,
                kind: { in: ["TRIP_FEE_INVOICE_ITEM", "RELOCATION_INVOICE_ITEM"] } },
              select: { kind: true, status: true },
            }),
          ])
        : [null, [] as { kind: string; status: string }[]];
      const waiverState =
        canViewFinance && job.type === "REMOVAL" && job.status === "COMPLETED"
          ? await getLateReturnWaiverState(job.id)
          : null;
      const choices = canViewFinance
        ? new Map(await Promise.all(pendingDeliveries.filter((p) => !p.deliveredOn && !p.removedAt && !p.substituteJobId).map(async (p) => [p.id, await substituteChoices(p.id)] as const)))
        : new Map<string, Awaited<ReturnType<typeof substituteChoices>>>();
      const pickupCase = await prisma.collectionCase.findFirst({ where: { pickupJobId: job.id, objectedAt: null }, select: { agreementId: true } });
      let agreementStatus: string | null = null;
      let rentalClosed = false;
      let depositId: string | null = null;
      if (canViewFinance && job.agreementId) {
        const agreement = await prisma.rentalAgreement.findUnique({
          where: { id: job.agreementId },
          select: { status: true },
        });
        agreementStatus = agreement?.status ?? null;
        rentalClosed = agreement?.status === "ENDED";
        if (rentalClosed) {
          const deposit = await prisma.deposit.findFirst({
            where: { agreementId: job.agreementId, refundedAt: null, refundable: true },
            select: { id: true },
          });
          depositId = deposit?.id ?? null;
        }
      }
      return { feeData, feePolicy, providerFees, waiverState, choices, pickupCase, agreementStatus, rentalClosed, depositId };
    })(),
    prisma.staffTask.count({ where: { jobId: job.id, completedAt: null } }),
    tab === "activity" ? getVisitTimeline(job.id) : Promise.resolve([]),
  ]);
  const { feeData, feePolicy, providerFees, waiverState, choices, pickupCase } = ownerBlock;

  const customerName = job.customer ? (job.customer.user.name ?? job.customer.user.email) : "No customer";
  const address = job.serviceAddress
    ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}, ${job.serviceAddress.state} ${job.serviceAddress.zip}`
    : null;
  const personLabel =
    assignedLabel(job.assignedToUserId, teamMembers) ??
    (job.assignedToUserId ? "Assigned" : "Not assigned");
  const nextStep = visitNextStep(
    {
      status: job.status,
      type: job.type,
      scheduledAt: job.scheduledAt,
      assignedToUserId: job.assignedToUserId,
      hasOpenFollowUp: openFollowUps > 0,
      rentalClosed: ownerBlock.rentalClosed,
      depositId: ownerBlock.depositId,
    },
    { role: session.user.role },
    now,
  );
  const tabHref = (value: VisitTab) =>
    `/desk/jobs/${job.id}?tab=${value}${fromBoard ? "&from=board" : ""}`;
  const tabClass = (active: boolean) =>
    `rounded-control px-3 py-2 text-sm font-semibold ${active ? "bg-ink text-white" : "text-ink-soft hover:bg-subtle"}`;

  return (
    <div className="max-w-2xl">
      <RecordHeader
        title={`${jobKindLabel(job)} for ${customerName}`}
        pills={[visitPill(job)]}
        subtitle={[visitWhen(job, now), address].filter(Boolean).join(" · ")}
        back={
          fromBoard
            ? { href: "/desk/dispatch", label: "Board" }
            : { href: "/desk/jobs", label: "Visits" }
        }
        actions={[
          {
            kind: "link",
            label: "View / print work order",
            href: `/desk/jobs/${job.id}/work-order`,
          },
        ]}
      />
      <Toaster />
      <StatStrip
        items={[
          { label: "When", value: visitWhen(job, now) },
          { label: "Person", value: personLabel },
          {
            label: "Length",
            value: job.durationMinutes ? `${job.durationMinutes} minutes` : "Usual length",
          },
          { label: "Appliances", value: String(job.appliances.length) },
          ...(canViewFinance && ownerBlock.agreementStatus
            ? [{ label: "Rental", value: rentalAgreementStatusLabel(ownerBlock.agreementStatus) }]
            : []),
        ]}
      />
      {nextStep ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
          <p className="text-sm font-medium text-ink">
            <span className="font-bold">Next step:</span> {nextStep.label}
          </p>
          <ButtonLink href={nextStep.href} variant="primary">
            {nextStep.cta}
          </ButtonLink>
        </div>
      ) : null}

      <nav aria-label="Visit sections" className="mt-5 flex gap-1 border-b border-line pb-px">
        <Link href={tabHref("visit")} className={tabClass(tab === "visit")} aria-current={tab === "visit" ? "page" : undefined}>
          Visit
        </Link>
        <Link href={tabHref("messages")} className={tabClass(tab === "messages")} aria-current={tab === "messages" ? "page" : undefined}>
          Messages
        </Link>
        <Link href={tabHref("activity")} className={tabClass(tab === "activity")} aria-current={tab === "activity" ? "page" : undefined}>
          Activity
        </Link>
      </nav>

      {tab === "messages" && (
        <div className="mt-5">
          {job.customer && (canViewFinance || job.assignedToUserId === session.user.id) ? (
            <div>
              <SendTextPanel userId={session.user.id} entityType="Job" entityId={job.id} path={`/desk/jobs/${job.id}`}
                families={["job_scheduled", "job_reminder", "job_on_the_way", "job_completed"]}
                principal={{ customerId: "id" in job.customer ? job.customer.id : undefined }} />
              <div className="mt-4"><CallPanel userId={session.user.id} subject={{ type: "Job", id: job.id }} path={`/desk/jobs/${job.id}`} /></div>
            </div>
          ) : null}
          <ContextCommunicationPanel kind="Job" id={job.id} />
        </div>
      )}

      {tab === "activity" && (
        <div className="mt-5">
          <Timeline items={timeline} emptyLabel="Nothing has happened on this visit yet." now={now} />
        </div>
      )}

      {tab === "visit" && (
        <div>
          <SafetyIncidentButton jobId={job.id} />
          {pickupCase && job.status !== "COMPLETED" && job.status !== "CANCELLED" && (
            <div className="mt-3 rounded-lg border border-line p-3"><p className="mb-2 text-sm">If the customer says no at the door, do not take the appliance.</p>
              <NoteAction label="Customer objected — end the visit" noteLabel="What happened" secondary run={objectedAction.bind(null, pickupCase.agreementId)} /></div>
          )}
          {privateLocation && <section className="mt-4 rounded-lg border border-line bg-subtle p-3 text-sm">
            <h2 className="font-medium">Assigned-visit location details</h2>
            <p>Appointment confirmer: {privateLocation.permission.appointmentConfirmer === "TENANT" ? "tenant, if contact permitted" : "client"}</p>
            {!privateLocation.contactAllowed && session.user.role === "STAFF" &&
              <p>Client has not authorized tenant contact about this visit; phone and email are withheld.</p>}
            {privateLocation.unitLabel && <p>Unit: {privateLocation.unitLabel}</p>}
            {privateLocation.accessNotes && <p className="whitespace-pre-wrap">Private access notes: {privateLocation.accessNotes}</p>}
            <ul>{privateLocation.locationContacts.map(contact => <li key={contact.id}>
              {contact.name} ({contact.role}) · {contact.phone ?? "No phone"} · {contact.email ?? "No email"}
            </li>)}</ul>
          </section>}
          {job.maintenanceRequest && (
            <p className="mt-1 text-sm">
              <Link
                href={`/desk/maintenance/${job.maintenanceRequest.id}`}
                className="text-primary hover:underline"
              >
                &rarr; Scheduled for a maintenance request
              </Link>
            </p>
          )}

          <div className="mt-6">
            {feeData && <div className="space-y-3">
              <W24JobFeePanel jobId={job.id} version={feeData.version} kind="MISSED_TRIP"
                configuredCents={feePolicy?.missedTripFeeCents ?? 0}
                approvedCents={feeData.approvedTripFeeCents}
                eligible={feeData.status === "CANCELLED" && !!feeData.noShowAt && !!feeData.noShowEvidence}
                alreadyQueued={providerFees.some(o => o.kind === "TRIP_FEE_INVOICE_ITEM")} />
              <W24JobFeePanel jobId={job.id} version={feeData.version} kind="RELOCATION"
                configuredCents={feePolicy?.relocationFeeCents ?? 7500}
                approvedCents={feeData.approvedRelocationFeeCents}
                eligible={feeData.status !== "CANCELLED"}
                alreadyQueued={providerFees.some(o => o.kind === "RELOCATION_INVOICE_ITEM")} />
            </div>}
            <div id="schedule">
              <JobSchedulePanel
                jobId={job.id}
                version={job.version}
                status={job.status}
                scheduledAtLocal={job.scheduledAt ? denverLocalInput(job.scheduledAt) : ""}
                scheduledLabel={job.scheduledAt ? `${formatBusinessDate(job.scheduledAt)} at ${formatBusinessTime(job.scheduledAt)}` : null}
                durationMinutes={job.durationMinutes}
                assignedToUserId={job.assignedToUserId}
                assignedLabel={assignedLabel(job.assignedToUserId, teamMembers)}
                teamMembers={teamMembers.map((m) => ({ id: m.id, label: m.name ?? m.email }))}
                canSchedule={canViewFinance}
                canMarkNoShow={canViewFinance || job.assignedToUserId === session.user.id}
                noShowAt={"noShowAt" in job && job.noShowAt ? job.noShowAt.toISOString() : null}
              />
            </div>
          </div>

          {waiverState && <LateReturnWaiverForm jobId={job.id} state={waiverState} />}

          {partsUsed && (
            <div className="mt-6">
              <JobPartsUsed
                jobId={job.id}
                rows={partsUsed.rows}
                cost={partsUsed.cost}
                partOptions={partOptions.map((p) => ({
                  id: p.id,
                  label: `${p.modelNumber} — ${p.partNumber}${p.partName ? ` (${p.partName})` : ""}`,
                  onHand: p.quantityOnHand,
                }))}
              />
            </div>
          )}

          <div className="mt-6">
            <JobDetailPanel role={session.user.role} partsFromList={partsUsed?.cost.source === "ITEMIZED"} completionScope={completionScope} version={job.version} outcome={"outcome" in job ? (job.outcome ?? null) : null} pendingDeliveries={pendingDeliveries.map((p) => ({
              id: p.id,
              label: `${p.appliance.applianceType.name} #${p.appliance.assetNumber}`,
              originalDeliveryDate: businessDateKey(p.originalDeliveryDate),
              deliveredOn: p.deliveredOn ? businessDateKey(p.deliveredOn) : null,
              removed: p.removedAt !== null,
              hasCredit: p.creditId !== null,
              refundedCents: p.refundedCents,
              refundByHandCents: p.refundByHandCents,
              stripeUpdatePending: p.stripeUpdatePending,
              substituteLabel: p.substituteAppliance ? `#${p.substituteAppliance.assetNumber}` : null,
              substituteUnits: choices.get(p.id)?.units ?? [],
              substituteVisits: choices.get(p.id)?.visits ?? [],
            }))} today={businessDateKey(new Date())} job={{
              id: job.id, type: job.type, status: job.status,
              customerPickupHandoff: job.customerPickupHandoff === true,
              completionNotes: job.completionNotes, checklist: job.checklist,
              swapReplacementIds: job.swapReplacementIds,
              appliances: job.appliances.map(({ appliance, result, role, newHookupItemsInstalled }) => ({
                result: result ?? null, role, newHookupItemsInstalled, appliance: {
                  id: appliance.id, assetNumber: appliance.assetNumber, status: appliance.status,
                  applianceType: { name: appliance.applianceType.name },
                },
              })),
              photos: job.photos.map(({ id: photoId, altText }) => ({
                id: photoId,
                url: privatePhotoReadPath(photoId),
                altText,
              })),
              ...(job.canViewFinance ? { partsCostCents: job.partsCostCents, laborCostCents: job.laborCostCents } : {}),
            }} canViewFinance={canViewFinance} />
          </div>
          {canViewFinance && <RecordConnections kind="visit" id={job.id} />}
        </div>
      )}

      {nextStep ? (
        <ActionBar
          actions={[{ kind: "link", label: nextStep.cta, href: nextStep.href, primary: true }]}
          label="Next step"
        />
      ) : null}
    </div>
  );
}
