import Link from "next/link";
import { getLeadWorkspace } from "@/domains/leads/workspace";
import { FilterBar } from "@/components/desk/workspace";
import { Pagination } from "@/components/pagination";
import {
  Button,
  Card,
  DataList,
  EmptyState,
  Field,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";
import { formatBusinessDate, formatTaskDate } from "@/lib/business-date";
import { summarizeApplianceRequests } from "@/domains/leads/requests";

export const metadata = { title: "Leads" };

type LeadRow = Awaited<ReturnType<typeof getLeadWorkspace>>["records"][number];

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
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (view !== "all") params.set("view", view);
    if (filter.q) params.set("q", filter.q);
    if (page > 1) params.set("page", String(page));
    return `/desk/leads${params.size ? `?${params}` : ""}`;
  }

  const columns: DataListColumn<LeadRow>[] = [
    {
      key: "lead",
      header: "Lead",
      primary: true,
      cell: (lead) => (
        <div>
          <Link
            href={`/desk/leads/${lead.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {lead.contactName}
            {lead.companyName && ` · ${lead.companyName}`}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {lead.city ?? "City not provided"} · {lead.phone}
          </p>
        </div>
      ),
    },
    {
      key: "request",
      header: "Requested",
      cell: (lead) =>
        summarizeApplianceRequests(lead.applianceRequests, " × ") || "Appliances not specified",
    },
    {
      key: "status",
      header: "Status",
      cell: (lead) => {
        const last = lead.notesLog[0]?.createdAt;
        return (
          <div className="space-y-1">
            <p className="font-medium text-ink">
              {lead.status} · Score {lead.score}
              {lead.isHighValue && " · High value"}
            </p>
            <p>Source: {lead.howHeard || "Not recorded"}</p>
            <p>
              {last
                ? `Last note: ${formatBusinessDate(last)}`
                : `Received: ${formatBusinessDate(lead.createdAt)}`}
            </p>
          </div>
        );
      },
    },
    {
      key: "next",
      header: "Next action",
      cell: (lead) => {
        const task = lead.tasks[0];
        const quote = lead.estimates[0];
        return (
          <div className="space-y-2">
            {quote && (
              <p>
                <Link
                  href={`/desk/estimates/${quote.id}`}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  Quote #{quote.estimateNumber} awaiting reply
                </Link>
              </p>
            )}
            {task ? (
              <p>
                Follow-up:{" "}
                {task.dueDate ? formatTaskDate(task.dueDate) : "No date set"}{" "}
                <Link
                  href={`/desk/leads/${lead.id}#follow-up`}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  Open task
                </Link>
              </p>
            ) : (
              <Link
                href={`/desk/leads/${lead.id}#follow-up`}
                className="inline-flex min-h-11 items-center font-medium text-ink underline-offset-4 hover:underline"
              >
                Add next task
              </Link>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Choose the next conversation, quote or follow-up. Leads remain ranked by their existing score."
        primaryAction={{ href: "/desk/leads/new", label: "Add a lead" }}
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
        className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        method="get"
        action="/desk/leads"
      >
        {filter.status && (
          <input type="hidden" name="status" value={filter.status} />
        )}
        <input type="hidden" name="view" value={filter.view} />
        <Field
          label="Search contact or city"
          name="q"
          defaultValue={filter.q}
          maxLength={100}
        />
        <Button type="submit">Search leads</Button>
      </form>

      <Card
        title={`${data.totalCount} matching lead${data.totalCount === 1 ? "" : "s"}`}
      >
        <DataList
          rows={data.records}
          columns={columns}
          caption="Matching leads"
          empty={
            <EmptyState
              title="No leads match these filters"
              description="Adjust the filters or add a new inquiry."
            />
          }
        />
        <Pagination {...data} buildHref={(page) => href(page)} />
      </Card>
    </div>
  );
}
