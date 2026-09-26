import { notFound } from "next/navigation";
import Link from "next/link";
import { getLeadById } from "@/domains/leads";
import { LeadActionsPanel } from "./lead-actions-panel";

export const metadata = { title: "Lead" };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLeadById(id);

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
      <Link href="/desk/leads" className="text-sm text-gray-600 hover:underline">
        &larr; Back to leads
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {lead.contactName}
        {lead.companyName ? ` — ${lead.companyName}` : ""}
      </h1>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <LeadActionsPanel
          leadId={lead.id}
          status={lead.status}
          hasEmail={Boolean(lead.email)}
        />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-5 sm:grid-cols-2">
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
        <Field label="Best time to contact" value={lead.bestTimeToContact ?? "—"} />
        <Field label="How they heard about us" value={lead.howHeard ?? "—"} />
        <Field label="Desired term" value={lead.desiredTerm ?? "—"} />
        <Field
          label="Desired start date"
          value={
            lead.desiredStartDate
              ? new Date(lead.desiredStartDate).toLocaleDateString()
              : "—"
          }
        />
        <Field
          label="Address"
          value={
            [lead.addressLine1, lead.city, lead.zip].filter(Boolean).join(", ") ||
            "(not given)"
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
            lead.applianceRequests
              .map((r) => `${r.quantity}x ${r.applianceType.name}`)
              .join(", ") || "(none)"
          }
        />
        <Field
          label="Submitted"
          value={new Date(lead.createdAt).toLocaleString()}
        />
      </dl>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">
          Score: {lead.score}
          {lead.isHighValue && (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              High value
            </span>
          )}
        </h2>
        {scoreReasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
            {scoreReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      {lead.notes && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Notes from the lead</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
            {lead.notes}
          </p>
        </div>
      )}
    </div>
  );
}
