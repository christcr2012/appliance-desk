import Link from "next/link";
import { getLeadWorkspace } from "@/domains/leads/workspace";
import {
  PageHeader,
  FilterBar,
  SectionCard,
  EmptyState,
  primaryActionClass,
} from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import { formatBusinessDate, formatTaskDate } from "@/lib/business-date";
export const metadata = { title: "Leads" };
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    view?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const data = await getLeadWorkspace(await searchParams);
  const { filter } = data;
  function href(page = 1, status = filter.status ?? "ALL", view = filter.view) {
    const p = new URLSearchParams();
    if (status !== "ALL") p.set("status", status);
    if (view !== "all") p.set("view", view);
    if (filter.q) p.set("q", filter.q);
    if (page > 1) p.set("page", String(page));
    return `/desk/leads${p.size ? `?${p}` : ""}`;
  }
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Leads"
        description="Choose the next conversation, quote or follow-up. Leads remain ranked by their existing score."
        primaryAction={
          <Link className={primaryActionClass} href="/desk/leads/new">
            Add a lead
          </Link>
        }
      />
      <FilterBar
        label="Lead status"
        items={["ALL", "NEW", "CONTACTED", "CONVERTED", "LOST"].map(
          (status) => ({
            href: href(1, status),
            label:
              status === "ALL"
                ? "All"
                : status[0] + status.slice(1).toLowerCase(),
            active: status === (filter.status ?? "ALL"),
          }),
        )}
      />
      <FilterBar
        label="Lead next action"
        items={[
          { view: "all" as const, label: "All next actions" },
          { view: "awaiting-reply" as const, label: "Quote awaiting reply" },
          { view: "no-next-task" as const, label: "No next task" },
        ].map(({ view, label }) => ({
          href: href(1, filter.status ?? "ALL", view),
          label,
          active: filter.view === view,
        }))}
      />
      <form
        className="mb-6 flex flex-wrap items-end gap-2"
        method="get"
        action="/desk/leads"
      >
        {filter.status && (
          <input type="hidden" name="status" value={filter.status} />
        )}
        <input type="hidden" name="view" value={filter.view} />
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink">
          Search contact or city
          <input
            name="q"
            defaultValue={filter.q}
            maxLength={100}
            className="min-h-11 rounded-lg border border-control bg-surface px-3 text-ink"
          />
        </label>
        <button className={primaryActionClass}>Search leads</button>
      </form>
      <SectionCard
        title={`${data.totalCount} matching lead${data.totalCount === 1 ? "" : "s"}`}
      >
        {data.records.length ? (
          <ul className="divide-y divide-line">
            {data.records.map((lead) => {
              const task = lead.tasks[0];
              const quote = lead.estimates[0];
              const last = lead.notesLog[0]?.createdAt;
              return (
                <li
                  key={lead.id}
                  className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <div>
                    <Link
                      href={`/desk/leads/${lead.id}`}
                      className="font-semibold text-primary underline"
                    >
                      {lead.contactName}
                      {lead.companyName && ` · ${lead.companyName}`}
                    </Link>
                    <p className="text-sm text-ink-soft">
                      {lead.city ?? "City not provided"} · {lead.phone}
                    </p>
                    <p className="text-sm text-ink">
                      {lead.applianceRequests
                        .map((r) => `${r.quantity} × ${r.applianceType.name}`)
                        .join(", ") || "Appliances not specified"}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-ink">
                      {lead.status} · Score {lead.score}
                      {lead.isHighValue && " · High value"}
                    </p>
                    <p className="text-ink-soft">
                      Source: {lead.howHeard || "Not recorded"}
                    </p>
                    <p className="text-ink-soft">
                      {last
                        ? `Last note: ${formatBusinessDate(last)}`
                        : `Received: ${formatBusinessDate(lead.createdAt)}`}
                    </p>
                  </div>
                  <div className="text-sm">
                    {quote && (
                      <p>
                        <Link
                          href={`/desk/estimates/${quote.id}`}
                          className="text-primary underline"
                        >
                          Quote #{quote.estimateNumber} awaiting reply
                        </Link>
                      </p>
                    )}
                    {task ? (
                      <p className="text-ink">
                        Follow-up:{" "}
                        {task.dueDate
                          ? formatTaskDate(task.dueDate)
                          : "No date set"}{" "}
                        <Link
                          href={`/desk/leads/${lead.id}#follow-up`}
                          className="text-primary underline"
                        >
                          Open task
                        </Link>
                      </p>
                    ) : (
                      <Link
                        href={`/desk/leads/${lead.id}#follow-up`}
                        className="inline-flex min-h-11 items-center text-primary underline"
                      >
                        Add next task
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No leads match these filters"
            description="Adjust the filters or add a new inquiry."
          />
        )}
        <Pagination {...data} buildHref={(page) => href(page)} />
      </SectionCard>
    </div>
  );
}
