import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getEstimateDetail, totalMonthlyCents, totalOneTimeCents } from "@/domains/estimates";
import { formatCents } from "@/domains/pricing";
import { estimateStatusLabel } from "@/lib/status-labels";
import { EstimateLineItemsPanel } from "./line-items-panel";
import { SendEstimateButton } from "./send-estimate-button";
import { ConvertEstimatePanel } from "./convert-estimate-panel";

export const metadata = { title: "Estimate" };

const EDITABLE = new Set(["DRAFT", "CHANGES_REQUESTED"]);

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const estimate = await getEstimateDetail(id);

  if (!estimate) {
    notFound();
  }

  const monthly = totalMonthlyCents(estimate.lineItems);
  const oneTime = totalOneTimeCents(estimate.lineItems);
  const editable = EDITABLE.has(estimate.status);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <div className="max-w-3xl">
      <Link href="/desk/estimates" className="text-sm text-ink-soft hover:underline">
        &larr; All estimates
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Estimate #{estimate.estimateNumber} — {estimate.title}
          </h1>
          <p className="text-sm text-ink-soft">
            {estimate.customer ? (
              <>
                {estimate.customer.user.name ?? estimate.customer.user.email}
                {estimate.customer.companyName ? ` · ${estimate.customer.companyName}` : ""}
              </>
            ) : estimate.lead ? (
              <>
                {estimate.lead.contactName}
                {estimate.lead.companyName ? ` · ${estimate.lead.companyName}` : ""}
                <Link href={`/desk/leads/${estimate.lead.id}`} className="ml-2 text-xs underline">
                  (not yet a customer — view lead)
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <span className="inline-block rounded-full bg-canvas-alt px-3 py-1 text-sm font-medium text-ink-soft">
          {estimateStatusLabel(estimate.status)}
        </span>
      </div>

      {estimate.status === "CHANGES_REQUESTED" && estimate.changesRequestedMessage && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">The customer asked for changes:</p>
          <p className="mt-1">{estimate.changesRequestedMessage}</p>
          <p className="mt-2 text-xs text-amber-800">
            Update the line items below and send it again when you&apos;re ready.
          </p>
        </div>
      )}

      {estimate.status === "DECLINED" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          The customer declined this estimate.
          {estimate.declineReason && <p className="mt-1">{estimate.declineReason}</p>}
        </div>
      )}

      {estimate.status === "APPROVED" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">
            Approved by {estimate.approverName} ({estimate.approverEmail})
            {estimate.respondedAt && ` on ${new Date(estimate.respondedAt).toLocaleDateString()}`}.
          </p>
          {estimate.depositCents > 0 && (
            <p className="mt-1">
              {estimate.depositPaidAt
                ? `Deposit of ${formatCents(estimate.depositCents)} collected on ${new Date(estimate.depositPaidAt).toLocaleDateString()}.`
                : `Deposit of ${formatCents(estimate.depositCents)} not collected yet — the customer will be prompted to pay it on their own link.`}
            </p>
          )}
        </div>
      )}

      {(estimate.status === "SENT" || estimate.status === "VIEWED") && appUrl && (
        <p className="mt-4 text-sm text-ink-soft">
          Customer link:{" "}
          <a href={`${appUrl}/estimate/${estimate.id}`} className="text-ink underline">
            {appUrl}/estimate/{estimate.id}
          </a>
        </p>
      )}

      {estimate.createdAgreements.length > 0 && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-medium">
            Converted to {estimate.createdAgreements.length === 1 ? "a draft agreement" : "draft agreements"}:
          </p>
          <ul className="mt-1 list-inside list-disc">
            {estimate.createdAgreements.map((a) => (
              <li key={a.id}>
                <Link href={`/desk/agreements/${a.id}`} className="underline">
                  Agreement {a.id.slice(0, 8)} — {a.status}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-blue-800">
            Add the real appliances to each one from its own page, same as
            any other agreement.
          </p>
        </div>
      )}

      <EstimateLineItemsPanel
        estimateId={estimate.id}
        lineItems={estimate.lineItems.map((l) => ({
          id: l.id,
          description: l.description,
          quantity: l.quantity,
          monthlyPriceCents: l.monthlyPriceCents,
          oneTimeFeeCents: l.oneTimeFeeCents,
          propertyLabel: l.serviceAddress
            ? `${l.serviceAddress.line1}, ${l.serviceAddress.city}`
            : null,
        }))}
        serviceAddresses={(estimate.customer?.serviceAddresses ?? []).map((a) => ({
          id: a.id,
          label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
        }))}
        editable={editable}
      />

      {!estimate.customer && estimate.lead && (
        <p className="mt-2 text-xs text-ink-faint">
          This estimate is for a lead, not yet a customer, so there are no
          saved properties to pick from — line items can still be added
          without one.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-3 text-sm font-medium text-ink">
        {monthly > 0 && <span>{formatCents(monthly)}/month</span>}
        {oneTime > 0 && <span>{formatCents(oneTime)} one-time</span>}
        {estimate.depositCents > 0 && <span>{formatCents(estimate.depositCents)} deposit</span>}
      </div>

      {editable && (
        <div className="mt-6">
          <SendEstimateButton estimateId={estimate.id} hasLineItems={estimate.lineItems.length > 0} />
        </div>
      )}

      {estimate.status === "APPROVED" && (
        <div className="mt-6">
          <ConvertEstimatePanel
            estimateId={estimate.id}
            customerId={estimate.customer?.id ?? null}
            serviceAddresses={(estimate.customer?.serviceAddresses ?? []).map((a) => ({
              id: a.id,
              label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
            }))}
            hasUnassignedLines={estimate.lineItems.some((l) => !l.serviceAddressId)}
            distinctPropertyCount={
              new Set(estimate.lineItems.map((l) => l.serviceAddressId).filter(Boolean)).size
            }
            depositAlreadyCollectedCents={estimate.depositPaidAt ? estimate.depositCents : null}
          />
        </div>
      )}
    </div>
  );
}
