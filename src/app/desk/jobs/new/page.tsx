import { getCustomers, getCustomerById, getCustomerApplianceOptions } from "@/domains/customers";
import { getAgreementById } from "@/domains/agreements";
import { getMaintenanceRequestById } from "@/domains/maintenance";
import { NewJobForm } from "./new-job-form";

export const metadata = { title: "Schedule a job" };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ agreementId?: string; maintenanceRequestId?: string; customerId?: string }>;
}) {
  const { agreementId, maintenanceRequestId, customerId } = await searchParams;
  const [customers, agreement, maintenanceRequest] = await Promise.all([
    getCustomers(),
    agreementId ? getAgreementById(agreementId) : Promise.resolve(null),
    maintenanceRequestId ? getMaintenanceRequestById(maintenanceRequestId) : Promise.resolve(null),
  ]);

  let maintenanceContext = null;
  if (maintenanceRequest && !agreement) {
    const [customerDetail, applianceOptions] = await Promise.all([
      getCustomerById(maintenanceRequest.customerId),
      getCustomerApplianceOptions(maintenanceRequest.customerId),
    ]);
    maintenanceContext = {
      maintenanceRequestId: maintenanceRequest.id,
      customerId: maintenanceRequest.customerId,
      customerName: maintenanceRequest.customer.user.name ?? maintenanceRequest.customer.user.email,
      serviceAddresses: (customerDetail?.serviceAddresses ?? []).map((a) => ({
        id: a.id,
        label: `${a.line1}, ${a.city}, ${a.state} ${a.zip}`,
      })),
      appliances: applianceOptions,
      defaultApplianceId: maintenanceRequest.applianceId ?? null,
    };
  }

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
          maintenanceContext={maintenanceContext}
          // Quick action from a customer's own page (/desk/customers/[id])
          // — preselects them without needing an agreement or maintenance
          // request already in hand.
          initialCustomerId={!agreement && !maintenanceContext ? customerId : undefined}
        />
      </div>
    </div>
  );
}
