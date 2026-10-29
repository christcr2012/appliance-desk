import { requireRole } from "@/lib/session";
import { getCustomers } from "@/domains/customers";
import { getLeadById } from "@/domains/leads";
import { summarizeApplianceRequests } from "@/domains/leads/requests";
import { NewEstimateForm } from "./new-estimate-form";

export const metadata = { title: "New estimate" };

const TERM_WORDS: Record<string, string> = {
  "month-to-month": "Month to month",
  "6-month": "6 months",
  "12-month": "12 months",
};

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; leadId?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { customerId, leadId } = await searchParams;

  // AR-4b: ?leadId= quotes an existing lead. It wins over ?customerId=
  // (when both are present the leadId is ignored per LEADS.md 3.6 — read:
  // the customer picker flow proceeds; the lead prop below only applies
  // when no customerId was given).
  let lead: { id: string; contactName: string; prefillTitle: string } | undefined;
  if (leadId && !customerId) {
    const found = await getLeadById(leadId);
    if (found && !found.mergedIntoLeadId) {
      const summary = summarizeApplianceRequests(found.applianceRequests);
      const term = found.desiredTerm ? TERM_WORDS[found.desiredTerm] : null;
      lead = {
        id: found.id,
        contactName: found.contactName,
        prefillTitle: [summary, term].filter(Boolean).join(" · "),
      };
    }
  }

  const customers = await getCustomers();

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">New estimate</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Start with the basics — you&apos;ll add line items and send it on the
        next screen.
      </p>

      <div className="mt-6">
        <NewEstimateForm
          customers={customers.map((c) => ({
            id: c.id,
            name: c.user.name ?? c.user.email,
            companyName: c.companyName,
            isPropertyManager: c.isPropertyManager,
          }))}
          initialCustomerId={customerId}
          lead={lead}
        />
      </div>
    </div>
  );
}
