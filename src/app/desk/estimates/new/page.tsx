import { requireRole } from "@/lib/session";
import { getCustomers } from "@/domains/customers";
import { NewEstimateForm } from "./new-estimate-form";

export const metadata = { title: "New estimate" };

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { customerId } = await searchParams;
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
        />
      </div>
    </div>
  );
}
