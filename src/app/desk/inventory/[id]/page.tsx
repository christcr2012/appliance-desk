import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getApplianceById,
  getPartRecordsForModel,
  getApplianceProfitability,
} from "@/domains/inventory";
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

  const [partRecords, profitability] = await Promise.all([
    appliance.model ? getPartRecordsForModel(appliance.model) : Promise.resolve([]),
    getApplianceProfitability(id),
  ]);

  return (
    <div className="max-w-2xl">
      <Link href="/desk/inventory" className="text-sm text-gray-600 hover:underline">
        &larr; Back to inventory
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {appliance.assetNumber} — {appliance.applianceType.name}
        </h1>
        <Link
          href={`/desk/inventory/${id}/qr`}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
        >
          Print QR label
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Added {new Date(appliance.createdAt).toLocaleDateString()}
        {appliance.acquisitionCostCents !== null &&
          ` · cost ${formatCents(appliance.acquisitionCostCents)}`}
        {appliance.purchaseDate &&
          ` · purchased ${new Date(appliance.purchaseDate).toLocaleDateString()}`}
      </p>

      {profitability && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-gray-500">Lifetime revenue</p>
            <p className="font-medium text-gray-900">
              {formatCents(profitability.revenueCents)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Repair costs</p>
            <p className="font-medium text-gray-900">
              {formatCents(profitability.repairCostCents)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Net contribution</p>
            <p className="font-medium text-gray-900">
              {formatCents(profitability.netContributionCents)}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Paid for itself?</p>
            <p className="font-medium text-gray-900">
              {profitability.paidForItself ? "Yes" : "Not yet"}
            </p>
          </div>
        </div>
      )}

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
