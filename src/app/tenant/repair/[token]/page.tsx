import { notFound } from "next/navigation";
import { tenantRepairOptions } from "@/domains/customers/location-contacts";
import { TenantRepairForm } from "./tenant-repair-form";
export const metadata = { title: "Report an appliance repair" };
export default async function TenantRepairPage({ params }: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params;
  const options = await tenantRepairOptions(token);
  if (!options) notFound();
  return <main className="mx-auto max-w-lg space-y-5 px-4 py-10">
    <h1 className="text-2xl font-semibold">Report an appliance problem</h1>
    <p className="text-sm text-ink-soft">For {options.location}. This link is single-use and expires after seven days. Reports go to the property client, not a tenant account.</p>
    <TenantRepairForm token={token} appliances={options.appliances} />
  </main>;
}
