import { getCustomers } from "@/domains/customers";
import { getAppliances } from "@/domains/inventory";
import { RentalWizard } from "./rental-wizard";

export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const [customers, availableAppliances] = await Promise.all([
    getCustomers(),
    getAppliances({ status: "AVAILABLE" }),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">New rental agreement</h1>
      <p className="mt-1 text-sm text-gray-600">
        A few quick steps — customer, term & fees, appliances, then send it
        for signature.
      </p>

      {customers.length === 0 ? (
        <p className="mt-6 rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No customers yet — the first step below lets you add one, or convert
          a lead into a customer first from /desk/leads.
        </p>
      ) : null}

      <div className="mt-6">
        <RentalWizard
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
          initialCustomerId={customerId}
        />
      </div>
    </div>
  );
}
