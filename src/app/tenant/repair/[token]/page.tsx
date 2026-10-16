import { displayCustomerLanguage } from "@/domains/language/review";
import { parseCustomerLanguage } from "@/domains/language/copy";
import { portalLabel, portalStatement } from "@/domains/language/portal-copy";
import { CustomerLanguageProvider } from "@/domains/language/client-portal";
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
  const language=await displayCustomerLanguage(parseCustomerLanguage(options.preferredLanguage));
  return <CustomerLanguageProvider language={language}><main lang={language} className="mx-auto max-w-lg space-y-5 px-4 py-10">
    <h1 className="text-2xl font-semibold">{portalLabel(language,"Report an appliance problem")}</h1>
    <p className="text-sm text-ink-soft">{portalStatement(language,"repairLink",{location:options.location})}</p>
    <TenantRepairForm token={token} appliances={options.appliances} />
  </main></CustomerLanguageProvider>;
}
