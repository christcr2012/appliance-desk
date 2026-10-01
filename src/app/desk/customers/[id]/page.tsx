import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { OperationalCustomer } from "./operational-customer";
import {
  CUSTOMER_TABS,
  customerTab,
  getCustomerIdentity,
  getCustomerOverview,
  getCustomerProperties,
  getCustomerRentals,
  getCustomerService,
} from "@/domains/customers/workspace";
import {
  getCustomerTimelinePage,
  timelineFilter,
} from "@/domains/customers/timeline-page";
import {
  PageHeader,
  SectionCard,
  EmptyState,
  FilterBar,
  Metric,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { parsePage } from "@/domains/pagination";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { ResendActivationButton } from "./resend-activation-button";
import { AddNoteForm } from "./add-note-form";
import { ContactsPanel } from "./contacts-panel";
import { ServiceAddressesPanel } from "./service-addresses-panel";
import { LinkedTasksPanel } from "@/components/linked-tasks-panel";
import { BillingContext } from "./billing-context";
import { PropertyServiceContext } from "@/components/desk/property-service-context";

export const metadata = { title: "Customer" };
type Search = {
  tab?: string;
  page?: string;
  filter?: string;
  cursor?: string;
  newAccount?: string;
  emailSent?: string;
};
export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if ((session.user as { role?: string }).role === "STAFF")
    return <OperationalCustomer id={id} />;
  const query = await searchParams;
  const customer = await getCustomerIdentity(id);
  if (!customer) notFound();
  const tab = customerTab(query.tab);
  const base = `/desk/customers/${encodeURIComponent(id)}`;
  const href = (name: string, page = 1) =>
    `${base}?tab=${name}${page > 1 ? `&page=${page}` : ""}`;
  let content: React.ReactNode;
  if (tab === "overview") {
    const data = await getCustomerOverview(id);
    content = (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Active rentals"
            value={data.activeRentals}
            href={href("rentals")}
            basis="Active agreements"
          />
          <Metric
            label="Open service"
            value={data.openService}
            href={href("service")}
            basis="Requests awaiting resolution"
          />
          <Metric
            label="Properties"
            value={data.propertyCount}
            href={href("properties")}
            basis="Service addresses on file"
          />
        </div>
        <SectionCard title="Next visit">
          {data.nextJob ? (
            <Link
              className="text-primary underline"
              href={`/desk/jobs/${data.nextJob.id}`}
            >
              {data.nextJob.type.replaceAll("_", " ")} ·{" "}
              {formatBusinessDate(data.nextJob.scheduledAt!)} ·{" "}
              {formatBusinessTime(data.nextJob.scheduledAt!)}
              {data.nextJob.serviceAddress &&
                ` · ${data.nextJob.serviceAddress.line1}, ${data.nextJob.serviceAddress.city}`}
            </Link>
          ) : (
            <EmptyState
              title="No scheduled visit"
              action={
                <Link
                  className={secondaryActionClass}
                  href={`/desk/jobs/new?customerId=${id}`}
                >
                  Schedule a job
                </Link>
              }
            />
          )}
        </SectionCard>
        <SectionCard
          title="Customer login"
          description="Resend a password activation link when the customer needs it."
        >
          <ResendActivationButton customerId={id} />
        </SectionCard>
        <LinkedTasksPanel linkType="customer" linkId={id} tasks={data.tasks} />
      </div>
    );
  } else if (tab === "properties") {
    const data = await getCustomerProperties(id);
    content = data && (
      <div className="space-y-6">
        <ServiceAddressesPanel
          customerId={id}
          addresses={data.serviceAddresses}
          agreements={data.rentalAgreements.map((a) => ({
            id: a.id,
            status: a.status,
            serviceAddressId: a.serviceAddressId,
            monthlyCents: a.lines.reduce(
              (sum, l) => sum + l.monthlyPriceCents,
              0,
            ),
          }))}
          jobs={data.jobs}
        />
        <PropertyServiceContext
          addresses={data.serviceAddresses}
          jobs={data.jobs}
          requests={data.maintenanceRequests}
        />
        <ContactsPanel customerId={id} contacts={data.contacts} />
      </div>
    );
  } else if (tab === "rentals") {
    const data = await getCustomerRentals(id, parsePage(query.page));
    content = (
      <SectionCard title="Rental agreements">
        {data.records.length ? (
          <ul className="divide-y divide-line">
            {data.records.map((a) => (
              <li key={a.id} className="py-3">
                <Link
                  className="text-primary underline"
                  href={`/desk/agreements/${a.id}`}
                >
                  {a.status} · {a.lines.length} appliance line(s) ·{" "}
                  {formatCents(
                    a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
                  )}
                  /mo
                </Link>
                <p className="mt-1 text-sm text-ink-soft">
                  {a.serviceAddress.line1}, {a.serviceAddress.city}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No agreements yet" />
        )}
        <Pagination {...data} buildHref={(page) => href("rentals", page)} />
      </SectionCard>
    );
  } else if (tab === "service") {
    const data = await getCustomerService(id, parsePage(query.page));
    content = (
      <div className="space-y-6">
        <SectionCard title="Open service requests">
          {data.requests.length ? (
            <>
              <ul className="space-y-3">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <Link
                      className="text-primary underline"
                      href={`/desk/maintenance/${r.id}`}
                    >
                      {r.status} · {r.problem}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {r.priority} · Opened {formatBusinessDate(r.openedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {data.openRequestCount > data.requests.length && (
                <p className="mt-3 text-sm text-ink-soft">
                  Showing {data.requests.length} of {data.openRequestCount} open
                  requests.{" "}
                  <Link href="/desk/maintenance" className="underline">
                    Open service queue
                  </Link>
                </p>
              )}
            </>
          ) : (
            <EmptyState title="No open requests" />
          )}
        </SectionCard>
        <SectionCard title="Jobs">
          {data.jobs.length ? (
            <ul className="divide-y divide-line">
              {data.jobs.map((j) => (
                <li className="py-3" key={j.id}>
                  <Link
                    className="text-primary underline"
                    href={`/desk/jobs/${j.id}`}
                  >
                    {j.type.replaceAll("_", " ")} · {j.status}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {j.scheduledAt
                      ? `${formatBusinessDate(j.scheduledAt)} · ${formatBusinessTime(j.scheduledAt)}`
                      : "Unscheduled"}
                    {j.serviceAddress &&
                      ` · ${j.serviceAddress.line1}, ${j.serviceAddress.city}`}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No jobs yet" />
          )}
          <Pagination {...data} buildHref={(page) => href("service", page)} />
        </SectionCard>
      </div>
    );
  } else if (tab === "billing") {
    content = (
      <SectionCard title="Billing and referrals">
        <BillingContext id={id} />
      </SectionCard>
    );
  } else {
    const filter = timelineFilter(query.filter);
    const data = await getCustomerTimelinePage(id, filter, query.cursor);
    content = (
      <SectionCard
        title="Notes and activity"
        description="Internal notes remain visible only to owners and administrators."
      >
        <AddNoteForm customerId={id} />
        <div className="mt-4">
          <FilterBar
            label="Activity type"
            items={["all", "notes", "activity"].map((f) => ({
              href: `${href("activity")}&filter=${f}`,
              label:
                f === "all"
                  ? "All history"
                  : f === "notes"
                    ? "Notes"
                    : "Activity",
              active: filter === f,
            }))}
          />
        </div>
        {data.entries.length ? (
          <ul className="space-y-4">
            {data.entries.map((entry) => (
              <li key={entry.id} className="border-t border-line pt-3 text-sm">
                <p className="font-medium text-ink">
                  {entry.href ? (
                    <Link className="text-primary underline" href={entry.href}>
                      {entry.summary}
                    </Link>
                  ) : (
                    entry.summary
                  )}
                </p>
                <time
                  className="text-xs text-ink-soft"
                  dateTime={entry.createdAt.toISOString()}
                >
                  {formatBusinessDate(entry.createdAt)} ·{" "}
                  {formatBusinessTime(entry.createdAt)}
                </time>
                {entry.detail && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-ink">
                    {entry.detail}
                  </p>
                )}
                {entry.authorName && (
                  <p className="text-xs text-ink-soft">By {entry.authorName}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing recorded on this page" />
        )}
        <nav
          aria-label="Activity pagination"
          className="mt-4 flex flex-wrap gap-2"
        >
          {query.cursor && (
            <Link
              className={secondaryActionClass}
              href={`${href("activity")}&filter=${filter}`}
            >
              Newest entries
            </Link>
          )}
          {data.nextCursor && (
            <Link
              className={secondaryActionClass}
              href={`${href("activity")}&filter=${filter}&cursor=${encodeURIComponent(data.nextCursor)}`}
            >
              Older entries
            </Link>
          )}
        </nav>
      </SectionCard>
    );
  }
  return (
    <div className="max-w-5xl">
      <Link
        href="/desk/customers"
        className="mb-3 inline-flex min-h-11 items-center text-sm text-primary underline"
      >
        ← Back to customers
      </Link>
      <PageHeader
        title={customer.user.name ?? customer.user.email}
        description={
          <>
            {customer.user.email}
            {customer.phone && ` · ${customer.phone}`}
            {customer.companyName && ` · ${customer.companyName}`}
            {customer.archivedAt && <p>Archived customer record</p>}
          </>
        }
        primaryAction={
          <Link
            className={primaryActionClass}
            href={`/desk/agreements/new?customerId=${id}`}
          >
            + New agreement
          </Link>
        }
        secondaryActions={
          <>
            <Link
              className={secondaryActionClass}
              href={`/desk/jobs/new?customerId=${id}`}
            >
              Schedule a job
            </Link>
            <Link
              className={secondaryActionClass}
              href={`/desk/estimates/new?customerId=${id}`}
            >
              New estimate
            </Link>
            <Link
              className={secondaryActionClass}
              href={`/desk/billing/customer/${id}`}
            >
              View statement
            </Link>
          </>
        }
      />
      {query.newAccount === "1" && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-line bg-subtle p-4 text-sm text-ink"
        >
          {query.emailSent === "1"
            ? "Account created. An activation email was sent so the customer can set their password."
            : "Account created. The activation email could not be sent; use Resend activation email on Overview to try again."}
        </p>
      )}
      <FilterBar
        label="Customer record sections"
        items={CUSTOMER_TABS.map((name) => ({
          href: href(name),
          label: name[0].toUpperCase() + name.slice(1),
          active: tab === name,
        }))}
      />
      {content}
    </div>
  );
}
