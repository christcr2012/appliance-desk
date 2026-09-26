import { getCustomers } from "@/domains/customers";
import { getAgreementById } from "@/domains/agreements";
import { NewJobForm } from "./new-job-form";

export const metadata = { title: "Schedule a job" };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ agreementId?: string }>;
}) {
  const { agreementId } = await searchParams;
  const [customers, agreement] = await Promise.all([
    getCustomers(),
    agreementId ? getAgreementById(agreementId) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Schedule a job</h1>
      <p className="mt-1 text-sm text-gray-600">
        A delivery, install, swap, removal, or maintenance visit.
      </p>

      <div className="mt-6">
        <NewJobForm
          customers={customers.map((c) => ({
            id: c.id,
            name: c.user.name ?? c.user.email,
            serviceAddresses: c.serviceAddresses.map((a) => ({
              id: a.id,
              label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
            })),
          }))}
          agreement={
            agreement
              ? {
                  id: agreement.id,
                  customerId: agreement.customer.id,
                  serviceAddressId: agreement.serviceAddress.id,
                  appliances: agreement.lines.flatMap((l) =>
                    l.assignments.map((a) => ({
                      id: a.appliance.id,
                      label: `${a.appliance.applianceType.name} (${a.appliance.assetNumber})`,
                    })),
                  ),
                }
              : null
          }
        />
      </div>
    </div>
  );
}
