import { requireRole } from "@/lib/session";
import { summarizeApplianceRequests } from "@/domains/leads/requests";
import { getLeadEstimates } from "@/domains/leads/workspace";
import { PageHeader, SectionCard } from "@/components/desk/workspace";
import {
  formatBusinessDate,
  formatBusinessTime,
  formatTaskDate,
} from "@/lib/business-date";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLeadById } from "@/domains/leads";
import { getTasksForLead } from "@/domains/tasks";
import { LeadActionsPanel } from "./lead-actions-panel";
import { AddLeadNoteForm } from "./add-lead-note-form";
import { LinkedTasksPanel } from "@/components/linked-tasks-panel";
import { getMessageHistory } from "@/domains/messaging/history";
import { MessageHistoryPanel } from "@/components/desk/message-history-panel";
import { LeadCommunicationTimeline } from "./communication-timeline";

export const metadata = { title: "Lead" };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}


export default async function LeadDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ commsCursor?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const query = await searchParams;
  const [lead, tasks, estimates, messages] = await Promise.all([
    getLeadById(id),
    getTasksForLead(id),
    getLeadEstimates(id),
    getMessageHistory("Lead", id),
  ]);

  if (!lead) {
    notFound();
  }

  const scoreReasons = Array.isArray(lead.scoreReasons)
    ? (lead.scoreReasons as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  return (
    <div className="max-w-3xl">
      <Link
        href="/desk/leads"
        className="text-sm text-ink-soft hover:underline"
      >
        &larr; Back to leads
      </Link>

      <div className="mt-3">
        <PageHeader
          title={
            lead.contactName +
            (lead.companyName ? ` · ${lead.companyName}` : "")
          }
          description={
            lead.status === "CONVERTED"
              ? "Converted customer — continue in their customer record."
              : lead.status === "LOST"
                ? "Lost inquiry — the reason and history are retained."
                : "Contact this lead, review their quotes and set a next follow-up."
          }
          primaryAction={
            lead.convertedCustomerId
              ? {
                  href: `/desk/customers/${lead.convertedCustomerId}`,
                  label: "Open customer",
                }
              : undefined
          }
        />
      </div>
      <SectionCard
        title="Estimates"
        description="Statuses come from the existing estimates, independently of the lead stage."
      >
        {estimates.length ? (
          <>
            <ul className="space-y-2">
              {estimates.slice(0, 25).map((e) => (
                <li key={e.id}>
                  <Link
                    className="text-primary underline"
                    href={`/desk/estimates/${e.id}`}
                  >
                    Estimate #{e.estimateNumber} · {e.status}
                  </Link>
                </li>
              ))}
            </ul>
            {estimates.length > 25 && (
              <Link className="text-primary underline" href="/desk/estimates">
                Open all estimates
              </Link>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            No estimates linked to this lead.
          </p>
        )}
      </SectionCard>

      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <LeadActionsPanel
          leadId={lead.id}
          status={lead.status}
          hasEmail={Boolean(lead.email)}
        />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-line bg-white p-5 sm:grid-cols-2">
        <Field label="Phone" value={lead.phone} />
        <Field label="Email" value={lead.email ?? "(not given)"} />
        <Field
          label="Account type"
          value={lead.isBusiness ? "Business" : "Individual"}
        />
        <Field
          label="Property manager / landlord"
          value={lead.isPropertyManager ? "Yes" : "No"}
        />
        <Field
          label="Best time to contact"
          value={lead.bestTimeToContact ?? "—"}
        />
        <Field label="How they heard about us" value={lead.howHeard ?? "—"} />
        <Field label="Desired term" value={lead.desiredTerm ?? "—"} />
        <Field
          label="Desired start date"
          value={
            lead.desiredStartDate ? formatTaskDate(lead.desiredStartDate) : "—"
          }
        />
        <Field
          label="Address"
          value={
            [lead.addressLine1, lead.city, lead.zip]
              .filter(Boolean)
              .join(", ") || "(not given)"
          }
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
        <Field
          label="Appliances requested"
          value={
            summarizeApplianceRequests(lead.applianceRequests) || "(none)"
          }
        />
        <Field
          label="Submitted"
          value={`${formatBusinessDate(lead.createdAt)} · ${formatBusinessTime(lead.createdAt)}`}
        />
        {lead.status === "LOST" && (
          <Field label="Why it was lost" value={lead.lostReason ?? "—"} />
        )}
      </dl>

      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">
          Score: {lead.score}
          {lead.isHighValue && (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              High value
            </span>
          )}
        </h2>
        {scoreReasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
            {scoreReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      {lead.notes && (
        <div className="mt-6 rounded-lg border border-line bg-white p-5">
          <h2 className="font-medium text-ink">Notes from the lead</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
            {lead.notes}
          </p>
        </div>
      )}

      <div className="mt-6">
        <MessageHistoryPanel rows={messages} />
      </div>

      <div id="follow-up" className="mt-6 scroll-mt-24">
        <LinkedTasksPanel linkType="lead" linkId={lead.id} tasks={tasks} />
      </div>

      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">Contact history</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Log every call, email, text, or in-person conversation here — it stays
          with this lead even after it&apos;s converted or lost.
        </p>
        <AddLeadNoteForm leadId={lead.id} />
        <LeadCommunicationTimeline leadId={id} cursorToken={query.commsCursor} />

      </div>
    </div>
  );
}
