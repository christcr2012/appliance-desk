import { notFound } from "next/navigation";
import Link from "next/link";
import { getApplianceById, getPartRecordsForModel } from "@/domains/inventory";
import { formatCents } from "@/domains/pricing";
import { ApplianceDetailPanel } from "./appliance-detail-panel";
import { PartsSection } from "./parts-section";

export const metadata = { title: "Appliance" };

export default async function ApplianceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const appliance = await getApplianceById(id);

  if (!appliance) {
    notFound();
  }

  const partRecords = appliance.model
    ? await getPartRecordsForModel(appliance.model)
    : [];

  return (
    <div className="max-w-2xl">
      <Link href="/desk/inventory" className="text-sm text-gray-600 hover:underline">
        &larr; Back to inventory
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {appliance.assetNumber} — {appliance.applianceType.name}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        Added {new Date(appliance.createdAt).toLocaleDateString()}
        {appliance.acquisitionCostCents !== null &&
          ` · cost ${formatCents(appliance.acquisitionCostCents)}`}
        {appliance.purchaseDate &&
          ` · purchased ${new Date(appliance.purchaseDate).toLocaleDateString()}`}
      </p>

      <div className="mt-6 space-y-6">
        <ApplianceDetailPanel appliance={appliance} />
        <PartsSection
          modelNumber={appliance.model}
          manufacturer={appliance.manufacturer}
          applianceTypeId={appliance.applianceTypeId}
          partRecords={partRecords}
        />
      </div>
    </div>
  );
}
