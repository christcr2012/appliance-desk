import { validInitialAddress } from "@/domains/customers/workspace";
import { requireRole } from "@/lib/session";
import { getCustomers } from "@/domains/customers";
import { getAppliances } from "@/domains/inventory";
import { RentalWizard } from "./rental-wizard";
import { getAgreementById } from "@/domains/agreements";
import { draftRequestId } from "@/domains/agreements/draft-request";
import { notFound, redirect } from "next/navigation";

export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{
    customerId?: string;
    serviceAddressId?: string;
    draftId?: string;
    requestKey?: string;
  }>;
}) {
  const session = await requireRole("OWNER", "ADMIN");
  const query = await searchParams;
  let requestedId: string | undefined;
  let requestKey: string | undefined;
  if (query.requestKey) {
    try {
      requestedId = draftRequestId(session.user.id, query.requestKey);
      requestKey = query.requestKey;
    } catch {
      /* Invalid URL input cannot supply a save identity. */
    }
  }
  if (query.draftId && query.draftId.length > 128) notFound();
  const draftId = query.draftId ?? requestedId;
  const draft = draftId ? await getAgreementById(draftId) : null;
  if (query.draftId && !draft) notFound();
  if (draft && draft.status !== "DRAFT")
    redirect(`/desk/agreements/${draft.id}`);
  const customerId = draft?.customerId ?? query.customerId;
  const serviceAddressId = draft?.serviceAddressId ?? query.serviceAddressId;
  const [customers, availableAppliances] = await Promise.all([
    getCustomers(),
    getAppliances({ status: "AVAILABLE" }),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">New rental agreement</h1>
      <p className="mt-1 text-sm text-gray-600">
        A few quick steps — customer, term & fees, appliances, then send it for
        signature.
      </p>

      {customers.length === 0 ? (
        <p className="mt-6 rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No customers yet — the first step below lets you add one, or convert a
          lead into a customer first from /desk/leads.
        </p>
      ) : null}

      <div className="mt-6">
        <RentalWizard
          initialRequestKey={requestKey}
          initialDraft={
            draft
              ? {
                  id: draft.id,
                  customerId: draft.customerId,
                  customerName:
                    draft.customer.user.name ?? draft.customer.user.email,
                  serviceAddressId: draft.serviceAddressId,
                  termMonths: draft.termMonths,
                  depositCents: draft.depositCents,
                  damageWaiverCents: draft.damageWaiverCents,
                  lateFeeGraceDays: draft.lateFeeGraceDays,
                  lateFeeCents: draft.lateFeeCents,
                  lateFeePercent: draft.lateFeePercent,
                  taxRatePermille: draft.taxRatePermille,
                  paidInFullInAdvance: draft.paidInFullInAdvance,
                  lines: draft.lines.map((l) => ({
                    id: l.id,
                    label: l.label,
                    monthlyPriceCents: l.monthlyPriceCents,
                    applianceNames: l.assignments
                      .map(
                        (a) =>
                          `${a.appliance.applianceType.name} (${a.appliance.assetNumber})`,
                      )
                      .join(", "),
                  })),
                }
              : undefined
          }
          customers={customers.map((c) => ({
            id: c.id,
            name: c.user.name ?? c.user.email,
            serviceAddresses: c.serviceAddresses.map((a) => ({
              id: a.id,
              label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
            })),
          }))}
          availableAppliances={availableAppliances.map((a) => ({
            id: a.id,
            assetNumber: a.assetNumber,
            typeName: a.applianceType.name,
          }))}
          initialCustomerId={
            customers.some((c) => c.id === customerId) ? customerId : undefined
          }
          initialServiceAddressId={validInitialAddress(
            customers,
            customerId,
            serviceAddressId,
          )}
        />
      </div>
    </div>
  );
}
