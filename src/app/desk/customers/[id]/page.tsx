import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { OperationalCustomer } from "./operational-customer";
import {
  getCustomerIdentity,
  getCustomerOverview,
  getCustomerProperties,
  getCustomerRentals,
  getCustomerService,
} from "@/domains/customers/workspace";
import { getCustomerTimelinePage } from "@/domains/customers/timeline-page";
import {
  AGREEMENT_PILL,
  CUSTOMER_STATUS_PILL,
  getCustomerNextSteps,
  getCustomerSummary,
  rentalBillingLine,
  type CustomerSummary,
} from "@/domains/customers/record";
import { getBills, type BillRow } from "@/domains/billing/bills-list";
import { inboxActions } from "@/domains/exceptions/inbox";
import { rentForNextBill } from "@/domains/portal/next-bill";
import { describeRentalLine } from "@/domains/portal/line-display";
import type { ExceptionItem } from "@/domains/exceptions";
import { SectionCard } from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { formatMonthYear, formatShortDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { jobStatusLabel, jobTypeLabel, maintenanceStatusLabel } from "@/lib/status-labels";
import {
  ActionBar,
  ActionButton,
  AreaTabs,
  EmptyState,
  Icon,
  NextStepCard,
  OverflowMenu,
  RecordHeader,
  StatStrip,
  StatusPill,
  StatusTabs,
  Timeline,
  Toaster,
  type ActionSpec,
  type MenuItem,
  type StatItem,
  type TimelineItem,
} from "@/components/kit";
import { ResendActivationButton } from "./resend-activation-button";
import { ContactsPanel } from "./contacts-panel";
import { ServiceAddressesPanel } from "./service-addresses-panel";
import { LinkedTasksPanel } from "@/components/linked-tasks-panel";
import { BillingContext } from "./billing-context";
import { PropertyServiceContext } from "@/components/desk/property-service-context";
import { getMessageHistory } from "@/domains/messaging/history";
import { MessageHistoryPanel } from "@/components/desk/message-history-panel";
import { RecordConnections } from "@/components/desk/record-connections";
import { resendActivationEmailAction } from "../actions";
import { customersBackHref, legacyCustomerRedirect, parseCustomerParams, type ActivityFilter, type CustomerRecordTab } from "./params";
import { CustomerRecordClient } from "./note-sheet";
import { billMobileCard, billRowActions } from "../../billing/bill-list-parts";

export const metadata = { title: "Customer" };

type Search = Record<string, string | string[] | undefined>;

/** "Resend account email" in the ⋯ menu: the same server action the Account section's button calls. */
async function resendAccountEmailAction(formData: FormData) {
  "use server";
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || !customerId) return { error: "This customer could not be found." };
  const result = await resendActivationEmailAction(customerId);
  return result.status === "sent" ? { success: "Account email sent" } : { error: result.message };
}

const ACTIVITY_FILTER_LABEL: Record<ActivityFilter, string> = {
  all: "All",
  notes: "Notes",
  communications: "Texts and calls",
  activity: "Activity",
};

function timelineItems(entries: { id: string; kind: string; summary: string; detail: string | null; authorName: string | null; createdAt: Date; href: string | null }[]): TimelineItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    at: entry.createdAt,
    title: entry.summary,
    detail: entry.detail ?? undefined,
    tone: entry.kind === "note" ? "info" : entry.kind === "activity" ? "neutral" : "good",
    actor: entry.authorName ?? "automatic",
    href: entry.href ?? undefined,
  }));
}

function nextStepActions(item: ExceptionItem): ActionSpec[] {
  // Same buttons as Today, without "Snooze…" (snoozing stays on Today, where the whole list is known).
  return inboxActions(item).actions;
}

function stats(summary: CustomerSummary, withOnTime: boolean): StatItem[] {
  const items: StatItem[] = [];
  if (summary.monthlyRentCents > 0) items.push({ label: "Monthly rent", value: formatMoney(summary.monthlyRentCents) });
  items.push({
    label: "Owes now",
    value: formatMoney(summary.owedCents),
    tone: summary.owedCents > 0 ? "attention" : "good",
    info: "owes-now",
  });
  if (summary.nextBill) {
    items.push({ label: "Next bill", value: `${formatShortDate(summary.nextBill.date)} · ${summary.autopay ? "autopay on" : "autopay off"}` });
  }
  if (summary.renting) items.push({ label: "Renting", value: summary.renting });
  if (withOnTime && summary.onTime) {
    const share = summary.onTime.paidOnTime / summary.onTime.counted;
    items.push({
      label: "Pays on time",
      value: `${summary.onTime.paidOnTime} of last ${summary.onTime.counted}`,
      tone: share >= 0.8 ? "good" : share < 0.5 ? "attention" : "neutral",
      info: "pays-on-time",
    });
  }
  return items;
}

function BillGroup({ title, rows, now, owing }: { title: string; rows: BillRow[]; now: Date; owing: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 rounded-card bg-surface px-4 py-3.5 lg:border lg:border-line">
            <div className="min-w-0 flex-1">{billMobileCard(row, now, owing)}</div>
            <OverflowMenu items={billRowActions(row)} label={`More for bill ${row.number}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if ((session.user as { role?: string }).role === "STAFF") return <OperationalCustomer id={id} />;
  const search = await searchParams;
  const legacy = legacyCustomerRedirect(id, search);
  if (legacy) redirect(legacy);
  const query = parseCustomerParams(search);
  const customer = await getCustomerIdentity(id);
  if (!customer) notFound();
  const now = new Date();
  const base = `/desk/customers/${encodeURIComponent(id)}`;
  const tabHref = (tab: CustomerRecordTab, extra: Record<string, string> = {}) =>
    `${base}?${new URLSearchParams({ tab, ...extra }).toString()}`;
  const noteHref = `${base}?note=1`;
  const name = customer.user.name ?? customer.user.email;

  const tab = query.tab;
  // Desktop treats `activity` like no tab (activity is already in the right column), except "See all activity".
  const desktopFullActivity = tab === "activity" && query.full;
  const desktopTab: Exclude<CustomerRecordTab, "activity"> | "activity-full" =
    desktopFullActivity ? "activity-full" : !tab || tab === "activity" ? "rentals" : tab;
  const phoneTab: CustomerRecordTab = tab === "messages" ? "activity" : (tab ?? "activity");
  const shown = new Set<string>([phoneTab, desktopTab]);
  const needRentals = shown.has("rentals");
  const needVisits = shown.has("visits");
  const needBills = shown.has("bills");
  const needDetails = shown.has("details");
  const timelineFilterValue: ActivityFilter = query.filter;

  const [summary, nextSteps, messages, timeline, railTimeline, rentals, service, openBills, paidBills, properties, overview] = await Promise.all([
    getCustomerSummary(id, now),
    getCustomerNextSteps(id, now),
    getMessageHistory("Customer", id),
    getCustomerTimelinePage(id, timelineFilterValue, query.cursor),
    timelineFilterValue === "all" && !query.cursor ? Promise.resolve(null) : getCustomerTimelinePage(id, "all"),
    needRentals ? getCustomerRentals(id, query.page) : Promise.resolve(null),
    needVisits ? getCustomerService(id, query.page) : Promise.resolve(null),
    needBills ? getBills({ status: "open", sort: "due-asc", customerId: id }, now) : Promise.resolve(null),
    needBills ? getBills({ status: "paid", sort: "due-desc", customerId: id, pageSize: 10 }, now) : Promise.resolve(null),
    needDetails ? getCustomerProperties(id) : Promise.resolve(null),
    needDetails ? getCustomerOverview(id, now) : Promise.resolve(null),
  ]);
  const railEntries = (railTimeline ?? timeline).entries.slice(0, 10);

  const owing = summary.owedCents > 0 && summary.oldestOpenBillId;
  const takePayment: ActionSpec | null = owing
    ? {
        kind: "link",
        label: "Take payment",
        href: `/desk/billing/customer/${encodeURIComponent(id)}/invoice/${encodeURIComponent(summary.oldestOpenBillId!)}#take-payment`,
        primary: true,
      }
    : null;
  const newQuote: ActionSpec = { kind: "link", label: "New quote", href: `/desk/estimates/new?customerId=${encodeURIComponent(id)}` };
  const scheduleVisit: ActionSpec = { kind: "link", label: "Schedule visit", href: `/desk/jobs/new?customerId=${encodeURIComponent(id)}` };
  const headerActions: ActionSpec[] = [
    ...(customer.phone ? [{ kind: "tel", label: "Call", phone: customer.phone } satisfies ActionSpec] : []),
    ...(takePayment ? [newQuote] : []),
    scheduleVisit,
  ];
  const menu: MenuItem[] = [
    ...(takePayment ? [{ ...takePayment, primary: false }] : []),
    { kind: "link", label: "New rental", href: `/desk/agreements/new?customerId=${encodeURIComponent(id)}` },
    { kind: "link", label: "View statement", href: `/desk/billing/customer/${encodeURIComponent(id)}` },
    { kind: "link", label: "Add a note", href: noteHref },
    ...(summary.hasPortalLogin
      ? [
          {
            kind: "form",
            label: "Resend account email",
            action: resendAccountEmailAction,
            fields: { customerId: id },
            pendingLabel: "Sending…",
          } satisfies MenuItem,
        ]
      : []),
    { kind: "link", label: "Locations", href: `${base}/locations` },
  ];

  const statusPill = CUSTOMER_STATUS_PILL[summary.status];
  const subtitle = [`Customer since ${formatMonthYear(summary.customerSince)}`, summary.city].filter(Boolean).join(" · ");
  const accountNotice = query.newAccount
    ? query.emailSent
      ? "Account created. Activation email sent."
      : "Account created. The email didn't send — use Resend account email in the ⋯ menu."
    : undefined;

  const nextStepCards = (className: string) =>
    nextSteps.length > 0 ? (
      <div className={className}>
        {nextSteps.map((item) => (
          <NextStepCard
            key={item.todoKey ?? item.title}
            title={item.title}
            actions={nextStepActions(item)}
            tone={item.severity === "high" ? "attention" : "info"}
          />
        ))}
      </div>
    ) : null;

  // ---- Sections ----
  const activitySection = (full: boolean) => (
    <section aria-label="Activity" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton spec={{ kind: "link", label: "Add a note", href: noteHref }} variant="secondary" icon="plus" />
      </div>
      <StatusTabs
        label="Activity type"
        param="filter"
        current={timelineFilterValue}
        items={(["all", "notes", "communications", "activity"] as const).map((value) => ({ value, label: ACTIVITY_FILTER_LABEL[value] }))}
      />
      {timelineFilterValue === "communications" ? (
        <div className="lg:hidden">
          <MessageHistoryPanel rows={messages} />
        </div>
      ) : null}
      <div className="rounded-card bg-surface px-4 py-1">
        <Timeline items={timelineItems(timeline.entries)} emptyLabel="Nothing recorded yet" now={now} />
      </div>
      <nav aria-label="Activity pages" className="flex flex-wrap gap-2">
        {query.cursor ? (
          <ActionButton
            spec={{ kind: "link", label: "Newest", href: tabHref("activity", { filter: timelineFilterValue, ...(full ? { full: "1" } : {}) }) }}
            variant="secondary"
          />
        ) : null}
        {timeline.nextCursor ? (
          <ActionButton
            spec={{
              kind: "link",
              label: "Older",
              href: tabHref("activity", { filter: timelineFilterValue, cursor: timeline.nextCursor, ...(full ? { full: "1" } : {}) }),
            }}
            variant="secondary"
          />
        ) : null}
      </nav>
    </section>
  );

  const rentalsSection = rentals ? (
    <section aria-label="Rentals" className="flex flex-col gap-2.5">
      {rentals.records.length === 0 ? (
        <EmptyState title="No rentals yet" action={{ kind: "link", label: "New rental", href: `/desk/agreements/new?customerId=${encodeURIComponent(id)}` }} />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rentals.records.map((agreement) => {
            const pill = AGREEMENT_PILL[agreement.status](agreement.startDate, now);
            const titleText =
              agreement.lines.map((line) => describeRentalLine(line)).join(" + ") +
              (agreement.termMonths ? ` · ${agreement.termMonths} months` : " · month to month");
            const detail = [
              agreement.serviceAddress.line1,
              agreement.startDate ? `started ${formatShortDate(agreement.startDate, now)}` : null,
              agreement.endDate ? `ends ${formatShortDate(agreement.endDate, now)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const billing =
              agreement.status === "ACTIVE"
                ? rentalBillingLine({
                    agreementId: agreement.id,
                    billingBlockedReason: agreement.billingBlockedReason,
                    stripeSubscriptionId: agreement.stripeSubscriptionId,
                    nextBillingDate: agreement.nextBillingDate,
                    rentCents: rentForNextBill(agreement.lines),
                    autopay: summary.autopay,
                  })
                : null;
            const chips = agreement.lines.flatMap((line) => line.assignments.map((a) => a.appliance));
            return (
              <li key={agreement.id} className="flex flex-col gap-2 rounded-card bg-surface px-4 py-3.5 lg:border lg:border-line">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 text-base font-bold text-ink">
                    <Link href={`/desk/agreements/${encodeURIComponent(agreement.id)}`} className="hover:underline">
                      {titleText}
                    </Link>
                  </h3>
                  <StatusPill label={pill.label} tone={pill.tone} />
                </div>
                <p className="text-sm text-ink-soft">{detail}</p>
                {chips.length > 0 ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Appliances">
                    {chips.map((appliance) => (
                      <li key={appliance.id}>
                        <Link
                          href={`/desk/inventory/${encodeURIComponent(appliance.id)}`}
                          className="relative inline-flex h-8 items-center rounded-full border border-line bg-tint px-3 text-sm font-semibold text-ink before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-surface"
                        >
                          {appliance.applianceType.name} {appliance.assetNumber}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {billing ? (
                  billing.kind === "blocked" ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-field bg-warning-bg/40 px-3 py-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold text-warning-ink">{billing.text}</p>
                      <ActionButton spec={{ kind: "link", label: "See why", href: billing.href }} variant="secondary" />
                    </div>
                  ) : (
                    <p className="flex items-start gap-1.5 text-sm text-ink-soft">
                      {billing.kind === "automatic" ? <Icon name="gear" className="mt-0.5 h-4 w-4 shrink-0" /> : null}
                      <span>{billing.text}</span>
                    </p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {rentals.records.length > 0 ? <Pagination {...rentals} buildHref={(page) => tabHref("rentals", { page: String(page) })} /> : null}
    </section>
  ) : null;

  const billsSection =
    openBills && paidBills ? (
      <section aria-label="Bills" className="flex flex-col gap-4">
        {openBills.rows.length === 0 && paidBills.rows.length === 0 ? (
          <EmptyState title="No bills yet" />
        ) : (
          <>
            <BillGroup title="Open" rows={openBills.rows} now={now} owing />
            <BillGroup title="Recent paid" rows={paidBills.rows} now={now} owing={false} />
          </>
        )}
        <div>
          <ActionButton spec={{ kind: "link", label: "Full statement", href: `/desk/billing/customer/${encodeURIComponent(id)}` }} variant="secondary" />
        </div>
      </section>
    ) : null;

  const visitsSection = service ? (
    <section aria-label="Visits" className="flex flex-col gap-4">
      <div>
        <ActionButton spec={{ ...scheduleVisit, primary: true }} variant="primary" icon="plus" />
      </div>
      {service.requests.length === 0 && service.jobs.length === 0 ? (
        <EmptyState title="No visits yet" />
      ) : (
        <>
          {service.requests.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <h3 className="text-base font-bold text-ink">Open service requests</h3>
              <ul className="flex flex-col gap-2.5">
                {service.requests.map((request) => (
                  <li key={request.id} className="rounded-card bg-surface px-4 py-3.5 lg:border lg:border-line">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="min-w-0 text-base font-bold text-ink">
                        <Link href={`/desk/maintenance/${encodeURIComponent(request.id)}`} className="hover:underline">
                          {request.problem}
                        </Link>
                      </h4>
                      <StatusPill label={maintenanceStatusLabel(request.status)} tone="info" />
                    </div>
                    <p className="text-sm text-ink-soft">Opened {formatShortDate(request.openedAt, now)}</p>
                  </li>
                ))}
              </ul>
              {service.openRequestCount > service.requests.length ? (
                <p className="text-sm text-ink-soft">
                  Showing {service.requests.length} of {service.openRequestCount}
                </p>
              ) : null}
            </section>
          ) : null}
          {service.jobs.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <h3 className="text-base font-bold text-ink">Visits</h3>
              <ul className="flex flex-col gap-2.5">
                {service.jobs.map((job) => (
                  <li key={job.id} className="rounded-card bg-surface px-4 py-3.5 lg:border lg:border-line">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="min-w-0 text-base font-bold text-ink">
                        <Link href={`/desk/jobs/${encodeURIComponent(job.id)}`} className="hover:underline">
                          {jobTypeLabel(job.type)} · {job.scheduledAt ? formatShortDate(job.scheduledAt, now) : "Not scheduled"}
                        </Link>
                      </h4>
                      <StatusPill label={jobStatusLabel(job.status)} tone="neutral" />
                    </div>
                    {job.serviceAddress ? (
                      <p className="text-sm text-ink-soft">
                        {job.serviceAddress.line1}, {job.serviceAddress.city}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Pagination {...service} buildHref={(page) => tabHref("visits", { page: String(page) })} />
            </section>
          ) : null}
        </>
      )}
    </section>
  ) : null;

  const messagesSection = (
    <section aria-label="Messages">
      <MessageHistoryPanel rows={messages} />
    </section>
  );

  const detailsSection =
    properties && overview ? (
      <section aria-label="Details" className="flex flex-col gap-4">
        <SectionCard title="Contact info">
          <dl className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Name", value: customer.user.name ?? "—" },
              { label: "Email", value: customer.user.email },
              { label: "Phone", value: customer.phone ?? "—" },
              { label: "Company", value: customer.companyName ?? "—" },
            ].map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-xs font-bold text-ink-soft">{field.label}</dt>
                <dd className="break-all text-[15px] text-ink">{field.value}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
        <div id="addresses" className="flex scroll-mt-20 flex-col gap-4">
          <ServiceAddressesPanel
            customerId={id}
            addresses={properties.serviceAddresses}
            agreements={properties.rentalAgreements.map((a) => ({
              id: a.id,
              status: a.status,
              serviceAddressId: a.serviceAddressId,
              monthlyCents: a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
            }))}
            jobs={properties.jobs}
          />
          <PropertyServiceContext addresses={properties.serviceAddresses} jobs={properties.jobs} requests={properties.maintenanceRequests} />
        </div>
        <div id="contacts" className="scroll-mt-20">
          <ContactsPanel customerId={id} contacts={properties.contacts} />
        </div>
        <div id="referrals" className="scroll-mt-20">
          <SectionCard title="Referrals and credits">
            <BillingContext id={id} />
          </SectionCard>
        </div>
        <div id="tasks" className="scroll-mt-20">
          <LinkedTasksPanel linkType="customer" linkId={id} tasks={overview.tasks} title="Linked tasks" />
        </div>
        <div id="account" className="scroll-mt-20">
          <SectionCard title="Account">
            {customer.archivedAt ? <p className="text-sm font-semibold text-ink">This customer is archived.</p> : null}
            {summary.hasPortalLogin ? <ResendActivationButton customerId={id} /> : null}
          </SectionCard>
        </div>
        <RecordConnections kind="customer" id={id} />
      </section>
    ) : null;

  const sectionFor = (which: string) =>
    which === "activity"
      ? activitySection(false)
      : which === "activity-full"
        ? activitySection(true)
        : which === "rentals"
          ? rentalsSection
          : which === "bills"
            ? billsSection
            : which === "visits"
              ? visitsSection
              : which === "messages"
                ? messagesSection
                : detailsSection;

  const liveRentals = summary.liveRentalCount;
  const phoneTabs = [
    { href: `${base}?tab=activity`, label: "Activity" },
    { href: `${base}?tab=rentals`, label: "Rentals", count: liveRentals || undefined },
    { href: `${base}?tab=bills`, label: "Bills" },
    { href: `${base}?tab=visits`, label: "Visits" },
    { href: `${base}?tab=details`, label: "Details" },
  ];
  const desktopTabs = [
    { href: `${base}?tab=rentals`, label: "Rentals", count: liveRentals || undefined },
    { href: `${base}?tab=bills`, label: "Bills" },
    { href: `${base}?tab=visits`, label: "Visits" },
    { href: `${base}?tab=messages`, label: "Messages" },
    { href: `${base}?tab=details`, label: "Details" },
  ];

  return (
    <CustomerRecordClient customerId={id} initialNoteOpen={search.note === "1"} accountNotice={accountNotice}>
      <div className="lg:flex lg:items-start lg:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <RecordHeader
            title={name}
            pills={[
              { label: statusPill.label, tone: statusPill.tone },
              ...(summary.owedCents > 0 ? [{ label: `Owes ${formatMoney(summary.owedCents)}`, tone: "attention" as const, info: "owes-now" as const }] : []),
            ]}
            subtitle={subtitle}
            contact={{ phone: customer.phone ?? undefined, email: customer.user.email, address: summary.primaryAddress ?? undefined }}
            primary={takePayment ?? { ...newQuote, primary: true }}
            actions={headerActions}
            overflow={menu}
            back={{ href: customersBackHref(query.from), label: "Customers" }}
          />
          <div className="lg:hidden">
            <StatStrip items={stats(summary, false)} />
          </div>
          <div className="hidden lg:block">
            <StatStrip items={stats(summary, true)} />
          </div>
          {nextStepCards("flex flex-col gap-2.5 lg:hidden")}
          <div className="lg:hidden">
            <AreaTabs label="Customer sections" items={phoneTabs} />
          </div>
          <div className="hidden lg:block">
            <AreaTabs label="Customer sections" items={desktopTabs} />
          </div>
          <div className="lg:hidden">{sectionFor(phoneTab)}</div>
          <div className="hidden lg:block">{sectionFor(desktopTab)}</div>
        </div>
        <aside aria-label="Next steps and activity" className="hidden lg:flex lg:w-[360px] lg:shrink-0 lg:flex-col lg:gap-4">
          {nextStepCards("flex flex-col gap-2.5")}
          <section aria-labelledby="rail-activity" className="rounded-card border border-line bg-surface px-4 py-3.5">
            <h2 id="rail-activity" className="text-base font-bold text-ink">
              Activity
            </h2>
            <Timeline items={timelineItems(railEntries)} emptyLabel="Nothing recorded yet" now={now} />
            <Link href={tabHref("activity", { full: "1" })} className="inline-flex min-h-10 items-center text-[15px] font-bold text-primary hover:underline">
              See all activity
            </Link>
          </section>
        </aside>
      </div>
      <Toaster />
      <ActionBar actions={[newQuote, { ...scheduleVisit, primary: true }]} label="Customer actions" />
    </CustomerRecordClient>
  );
}
