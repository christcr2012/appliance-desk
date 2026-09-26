import { getCustomers } from "@/domains/customers";
import { NewAgreementForm } from "./new-agreement-form";

export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const customers = await getCustomers();

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">New rental agreement</h1>
      <p className="mt-1 text-sm text-gray-600">
        Starts as a draft — add the appliances afterward, then send it for
        signature when it&apos;s ready.
      </p>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          No customers yet — convert a lead into a customer first, from
          /desk/leads.
        </p>
      ) : (
        <div className="mt-6">
          <NewAgreementForm
            customers={customers.map((c) => ({
              id: c.id,
              name: c.user.name ?? c.user.email,
              serviceAddresses: c.serviceAddresses.map((a) => ({
                id: a.id,
                label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
              })),
            }))}
            initialCustomerId={customerId}
          />
        </div>
      )}
    </div>
  );
}
