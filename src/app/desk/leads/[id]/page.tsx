import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { CallPanel } from "@/app/desk/_text/call-panel";
import { NextStepCard, RecordHeader, Stepper, Toaster } from "@/components/kit";
import type { ActionSpec, MenuItem, StepperStep } from "@/components/kit";
import { getLeadById, getLeadNotes } from "@/domains/leads";
import { getLeadEstimates } from "@/domains/leads/workspace";
import { leadStage } from "@/domains/leads/stage";
import { leadNextStep } from "@/domains/leads/next-step";
import { summarizeApplianceRequests } from "@/domains/leads/requests";
import { assignableLeadOwners } from "@/domains/leads/assignment";
import { getLeadResponseDays, defaultFollowUpKey } from "@/domains/leads/follow-up";
import { getTasksForLead } from "@/domains/tasks";
import { businessDateKey, formatBusinessDate, formatBusinessTime, formatTaskDate } from "@/lib/business-date";
import { getMessageHistory } from "@/domains/messaging/history";
import { MessageHistoryPanel } from "@/components/desk/message-history-panel";
import { LinkedTasksPanel } from "@/components/linked-tasks-panel";
import { AddLeadNoteForm } from "./add-lead-note-form";
import { LeadCommunicationTimeline } from "./communication-timeline";
import { LeadRowSheets, type SheetKind } from "../lead-row-sheets";
import { LeadDetailsSheet, LeadMergeSheet, PanelSheet, type MergeLeadSummary } from "./lead-record-sheets";

export const metadata = { title: "Lead" };

const QUOTE_STATUS_WORDS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes asked",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Became a rental",
};

const TERM_WORDS: Record<string, string> = {
  "month-to-month": "Month to month",
  "6-month": "6 months",
  "12-month": "12 months",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ commsCursor?: string; sheet?: string; tab?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  const query = await searchParams;
  // LD-1: the task read is OWNER/ADMIN-only; staff work the lead itself.
  const isStaff = session.user.role === "STAFF";
  const now = new Date();

  const [lead, tasks, estimates, messages, notes, responseDays, owners] = await Promise.all([
    getLeadById(id),
    isStaff ? Promise.resolve([] as Awaited<ReturnType<typeof getTasksForLead>>) : getTasksForLead(id),
    getLeadEstimates(id),
    getMessageHistory("Lead", id),
    getLeadNotes(id),
    getLeadResponseDays(),
    prisma.$transaction((tx) => assignableLeadOwners(tx)),
  ]);
  if (!lead) notFound();

  const openEstimate = estimates.find((e) => e.status === "SENT" || e.status === "VIEWED") ?? null;
  const stage = leadStage({
    status: lead.status,
    firstContactedAt: lead.firstContactedAt,
    openQuote: Boolean(openEstimate),
  });
  const step = leadNextStep(
    {
      stage,
      createdAt: lead.createdAt,
      nextFollowUpOn: lead.nextFollowUpOn,
      openQuote: openEstimate
        ? { status: openEstimate.status, sentAt: openEstimate.sentAt ?? null, viewedAt: openEstimate.viewedAt ?? null }
        : null,
      lostReason: lead.lostReason,
      responseDays,
    },
    now,
  );

  const [duplicateLead, mergedIntoLead, ownerUser, matchAudit] = await Promise.all([
    lead.possibleDuplicateOfLeadId ? getLeadById(lead.possibleDuplicateOfLeadId) : Promise.resolve(null),
    lead.mergedIntoLeadId
      ? prisma.lead.findUnique({ where: { id: lead.mergedIntoLeadId }, select: { contactName: true } })
      : Promise.resolve(null),
    lead.assignedToUserId
      ? prisma.user.findUnique({ where: { id: lead.assignedToUserId }, select: { name: true, email: true } })
      : Promise.resolve(null),
    prisma.auditLog.findFirst({
      where: { entityType: "Lead", entityId: lead.id, action: "lead.matches_customer" },
      orderBy: { createdAt: "desc" },
      select: { newValue: true },
    }),
  ]);
  const matchedCustomerId =
    matchAudit && typeof matchAudit.newValue === "object" && matchAudit.newValue !== null
      ? ((matchAudit.newValue as { customerId?: string }).customerId ?? null)
      : null;
  const matchedCustomer = matchedCustomerId
    ? await prisma.customer.findUnique({
        where: { id: matchedCustomerId },
        select: { user: { select: { name: true, email: true } } },
      })
    : null;

  const base = `/desk/leads/${lead.id}`;
  const tab = ["activity", "want", "quotes", "tasks"].includes(query.tab ?? "")
    ? (query.tab as string)
    : "activity";
  const sheetParam = (["followup", "assign", "log", "lost", "convert"] as const).includes(
    query.sheet as SheetKind,
  )
    ? (query.sheet as SheetKind)
    : undefined;
  const recordSheet = (kind: SheetKind) => `${base}?sheet=${kind}`;
  const closed = lead.status === "CONVERTED" || lead.status === "LOST" || Boolean(lead.mergedIntoLeadId);

  // --- Header ---
  const pills: { label: string; tone: "neutral" | "good" | "attention" | "info" | "danger"; info?: "lead-score" }[] = [
    { label: `Score ${lead.score}`, tone: "neutral", info: "lead-score" },
  ];
  if (lead.isHighValue) pills.push({ label: "High value", tone: "attention" });
  if (lead.isPropertyManager) pills.push({ label: "Property manager", tone: "info" });

  const overflow: MenuItem[] = [];
  if (!closed) {
    overflow.push({ kind: "link", label: "Convert to customer…", href: recordSheet("convert") });
    overflow.push({ kind: "link", label: "Mark lost…", href: recordSheet("lost") });
  }
  if (!isStaff) overflow.push({ kind: "link", label: "Send a text…", href: `${base}?sheet=text` });
  overflow.push({ kind: "link", label: "Call log…", href: `${base}?sheet=call` });
  overflow.push({ kind: "link", label: "Add a task", href: `${base}?tab=tasks` });

  const headerActions: ActionSpec[] = [];
  if (lead.convertedCustomerId) {
    headerActions.push({ kind: "link", label: "Open customer", href: `/desk/customers/${lead.convertedCustomerId}`, primary: true });
  } else if (!closed) {
    headerActions.push({ kind: "link", label: "Call", href: `tel:${lead.phone}`, primary: true });
    if (lead.email) headerActions.push({ kind: "link", label: "Email", href: `mailto:${lead.email}` });
  }

  // --- Stepper ---
  const stageIndex = { new: 0, contacted: 1, quoted: 2, won: 3, lost: -1 }[stage];
  const stepperSteps: StepperStep[] = ["New", "Contacted", "Quote sent", "Won"].map((label, i) => ({
    label,
    state: stage === "lost" ? "waiting" : i < stageIndex ? "done" : i === stageIndex ? "current" : "waiting",
  }));

  // --- Next step card ---
  const nextActions: ActionSpec[] = [];
  if (!closed) {
    if (stage === "new") {
      nextActions.push({ kind: "link", label: "Call", href: `tel:${lead.phone}`, primary: true });
      nextActions.push({ kind: "link", label: "Log a contact", href: recordSheet("log") });
    } else if (stage === "contacted") {
      nextActions.push({
        kind: "link",
        label: lead.nextFollowUpOn ? "Change follow-up" : "Set a follow-up",
        href: recordSheet("followup"),
        primary: true,
      });
      nextActions.push({ kind: "link", label: "New quote", href: `/desk/estimates/new?leadId=${lead.id}` });
    } else if (stage === "quoted") {
      if (openEstimate) {
        nextActions.push({ kind: "link", label: "View quote", href: `/desk/estimates/${openEstimate.id}`, primary: true });
      }
      nextActions.push({ kind: "link", label: "New quote", href: `/desk/estimates/new?leadId=${lead.id}` });
    }
  }

  const scoreReasons = Array.isArray(lead.scoreReasons)
    ? (lead.scoreReasons as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-field px-3 text-sm font-semibold ${
      active ? "bg-tint text-ink" : "text-ink-soft hover:bg-tint hover:text-ink"
    }`;
  const tabHref = (value: string) => `${base}?tab=${value}`;

  const summary = (l: NonNullable<typeof lead>): MergeLeadSummary => ({
    id: l.id,
    contactName: l.contactName,
    phone: l.phone,
    email: l.email,
    createdLabel: formatBusinessDate(l.createdAt),
    wants: summarizeApplianceRequests(l.applianceRequests),
  });

  return (
    <div className="max-w-3xl">
      <Toaster />
      <RecordHeader
        title={lead.contactName + (lead.companyName ? ` · ${lead.companyName}` : "")}
        pills={pills}
        contact={{ phone: lead.phone, email: lead.email ?? undefined }}
        subtitle={ownerUser ? `Owner: ${ownerUser.name ?? ownerUser.email}` : "Unassigned"}
        actions={headerActions}
        overflow={overflow}
        back={{ href: "/desk/leads", label: "Leads" }}
      />

      {mergedIntoLead ? (
        <p className="mb-4 rounded-card border border-line bg-tint px-4 py-3 text-[15px] text-ink">
          This lead was merged into{" "}
          <Link className="font-bold underline" href={`/desk/leads/${lead.mergedIntoLeadId}`}>
            {mergedIntoLead.contactName}
          </Link>
          .
        </p>
      ) : null}
      {duplicateLead && !lead.mergedIntoLeadId ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-tint px-4 py-3 text-[15px] text-ink">
          <span>
            Possible duplicate of{" "}
            <Link className="font-bold underline" href={`/desk/leads/${duplicateLead.id}`}>
              {duplicateLead.contactName}
            </Link>
          </span>
          <Link
            href={`${base}?sheet=merge`}
            className="inline-flex min-h-9 items-center rounded-field bg-primary px-3 text-sm font-bold text-on-primary"
          >
            Review &amp; merge
          </Link>
        </p>
      ) : null}
      {matchedCustomer ? (
        <p className="mb-4 rounded-card border border-line bg-tint px-4 py-3 text-[15px] text-ink">
          This person already has a customer account —{" "}
          <Link className="font-bold underline" href={`/desk/customers/${matchedCustomerId}`}>
            {matchedCustomer.user.name ?? matchedCustomer.user.email}
          </Link>
          .
        </p>
      ) : null}

      {stage === "lost" ? (
        <p className="mb-4">
          <span className="inline-flex items-center rounded-full bg-danger/10 px-3 py-1 text-sm font-bold text-danger">
            Lost{lead.lostReason ? ` — ${lead.lostReason}` : ""}
          </span>
        </p>
      ) : (
        <Stepper steps={stepperSteps} label="Lead stage" />
      )}

      {!closed || stage === "lost" ? (
        <div className="mt-4">
          <NextStepCard title={step.text} actions={nextActions} tone={step.tone === "attention" ? "attention" : "info"} />
        </div>
      ) : null}

      <nav aria-label="Lead sections" className="mt-6 flex flex-wrap gap-1 border-b border-line pb-2">
        <Link href={tabHref("activity")} aria-current={tab === "activity" ? "page" : undefined} className={tabClass(tab === "activity")}>
          Activity
        </Link>
        <Link href={tabHref("want")} aria-current={tab === "want" ? "page" : undefined} className={tabClass(tab === "want")}>
          What they want
        </Link>
        <Link href={tabHref("quotes")} aria-current={tab === "quotes" ? "page" : undefined} className={tabClass(tab === "quotes")}>
          Quotes
        </Link>
        {!isStaff ? (
          <Link href={tabHref("tasks")} aria-current={tab === "tasks" ? "page" : undefined} className={tabClass(tab === "tasks")}>
            Tasks
          </Link>
        ) : null}
      </nav>

      {tab === "activity" ? (
        <div className="mt-4 space-y-8">
          <section aria-label="Log a note or contact">
            <AddLeadNoteForm leadId={lead.id} />
          </section>
          {/* LEADS.md 3.5 allows three stacked groups when one merged
              timeline is not cheap; the groups are Messages, Notes, and
              Calls and texts. */}
          <section aria-label="Messages">
            <h2 className="font-bold text-ink">Messages</h2>
            <div className="mt-2">
              <MessageHistoryPanel rows={messages} />
            </div>
          </section>
          <section aria-label="Notes">
            <h2 className="font-bold text-ink">Notes</h2>
            {notes.length ? (
              <ul className="mt-2 space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-card border border-line bg-surface p-3">
                    <p className="whitespace-pre-wrap text-[15px] text-ink">{n.body}</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {n.kind === "CONTACTED" ? "Contact logged" : n.kind === "ATTEMPT" ? "Attempt logged" : "Note"} ·{" "}
                      {n.author?.name ?? n.author?.email ?? "—"} · {formatBusinessDate(n.createdAt)} · {formatBusinessTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-ink-soft">No notes yet</p>
            )}
          </section>
          {!isStaff ? (
            <section aria-label="Calls and texts">
              <h2 className="font-bold text-ink">Calls and texts</h2>
              <div className="mt-2">
                <LeadCommunicationTimeline leadId={id} cursorToken={query.commsCursor} />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "want" ? (
        <div className="mt-4">
          <dl className="grid grid-cols-1 gap-4 rounded-card border border-line bg-surface p-5 sm:grid-cols-2">
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email ?? "(not given)"} />
            <Field label="Account type" value={lead.isBusiness ? "Business" : "Individual"} />
            <Field label="Property manager / landlord" value={lead.isPropertyManager ? "Yes" : "No"} />
            <Field label="Best time to contact" value={lead.bestTimeToContact ?? "—"} />
            <Field label="How they heard about us" value={lead.howHeard ?? "—"} />
            <Field label="Wants" value={summarizeApplianceRequests(lead.applianceRequests) || "(none)"} />
            <Field label="Desired term" value={lead.desiredTerm ? (TERM_WORDS[lead.desiredTerm] ?? lead.desiredTerm) : "—"} />
            <Field label="Desired start date" value={lead.desiredStartDate ? formatTaskDate(lead.desiredStartDate) : "—"} />
            <Field label="How many" value={String(lead.quantity)} />
            <Field
              label="Address"
              value={[lead.addressLine1, lead.city, lead.zip].filter(Boolean).join(", ") || "(not given)"}
            />
            <Field
              label="In service area?"
              value={
                lead.inServiceArea === null
                  ? "Unknown (no address given)"
                  : lead.inServiceArea
                    ? "Yes"
                    : "No — outside configured service area"
              }
            />
            <Field label="Submitted" value={`${formatBusinessDate(lead.createdAt)} · ${formatBusinessTime(lead.createdAt)}`} />
            {lead.status === "LOST" ? <Field label="Why it was lost" value={lead.lostReason ?? "—"} /> : null}
          </dl>
          <div className="mt-4 rounded-card border border-line bg-surface p-5">
            <h2 className="font-bold text-ink">Score: {lead.score}</h2>
            {scoreReasons.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
                {scoreReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {lead.notes ? (
              <>
                <h3 className="mt-4 font-bold text-ink">Notes from the lead</h3>
                <p className="mt-1 whitespace-pre-wrap text-[15px] text-ink-soft">{lead.notes}</p>
              </>
            ) : null}
          </div>
          {!closed ? (
            <Link
              href={`${base}?tab=want&sheet=edit`}
              className="mt-4 inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary"
            >
              Edit
            </Link>
          ) : null}
        </div>
      ) : null}

      {tab === "quotes" ? (
        <div className="mt-4">
          {estimates.length ? (
            <ul className="space-y-2">
              {estimates.map((e) => (
                <li key={e.id} className="rounded-card border border-line bg-surface px-4 py-3">
                  <Link className="font-bold text-ink underline-offset-4 hover:underline" href={`/desk/estimates/${e.id}`}>
                    Quote #{e.estimateNumber}
                  </Link>{" "}
                  <span className="text-ink-soft">
                    {QUOTE_STATUS_WORDS[e.status] ?? e.status} · {formatBusinessDate(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-ink-soft">No quotes yet</p>
          )}
          {!closed ? (
            <Link
              href={`/desk/estimates/new?leadId=${lead.id}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-field bg-primary px-4 text-[15px] font-bold text-on-primary"
            >
              New quote
            </Link>
          ) : null}
        </div>
      ) : null}

      {tab === "tasks" && !isStaff ? (
        <div className="mt-4" id="follow-up">
          <LinkedTasksPanel linkType="lead" linkId={lead.id} tasks={tasks} />
        </div>
      ) : null}

      {/* Shared row sheets (follow-up / assign / log / lost / convert) */}
      {sheetParam ? (
        <LeadRowSheets
          lead={{
            id: lead.id,
            contactName: lead.contactName,
            stage,
            version: lead.version,
            nextFollowUpKey: lead.nextFollowUpOn ? businessDateKey(lead.nextFollowUpOn) : null,
          }}
          sheet={sheetParam}
          owners={owners}
          defaultFollowUpKey={defaultFollowUpKey(now)}
          closeHref={base}
        />
      ) : null}

      {query.sheet === "edit" ? (
        <LeadDetailsSheet
          leadId={lead.id}
          defaults={{
            contactName: lead.contactName,
            companyName: lead.companyName,
            isBusiness: lead.isBusiness,
            isPropertyManager: lead.isPropertyManager,
            phone: lead.phone,
            email: lead.email,
            bestTimeToContact: lead.bestTimeToContact,
            howHeard: lead.howHeard,
            desiredTerm: (lead.desiredTerm as "month-to-month" | "6-month" | "12-month" | null) ?? null,
            desiredStartDate: lead.desiredStartDate ? businessDateKey(lead.desiredStartDate) : null,
            quantity: lead.quantity,
            addressLine1: lead.addressLine1,
            city: lead.city,
            zip: lead.zip,
            notes: lead.notes,
          }}
          closeHref={`${base}?tab=want`}
        />
      ) : null}

      {query.sheet === "merge" && duplicateLead ? (
        <LeadMergeSheet
          current={summary(lead)}
          other={summary(duplicateLead)}
          defaultKeepId={duplicateLead.createdAt <= lead.createdAt ? duplicateLead.id : lead.id}
          closeHref={base}
        />
      ) : null}

      {query.sheet === "text" && !isStaff ? (
        <PanelSheet title="Send a text" closeHref={base}>
          <SendTextPanel
            userId={session.user.id}
            entityType="Lead"
            entityId={lead.id}
            path={base}
            families={["lead_received"]}
            principal={{ leadId: lead.id }}
          />
        </PanelSheet>
      ) : null}

      {query.sheet === "call" ? (
        <PanelSheet title="Call log" closeHref={base}>
          <CallPanel userId={session.user.id} subject={{ type: "Lead", id: lead.id }} path={base} />
        </PanelSheet>
      ) : null}
    </div>
  );
}
