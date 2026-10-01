import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAppliance } from "./operational-appliance";
import Link from "next/link";
import {
  getApplianceById,
  getPartRecordsForModel,
  getApplianceProfitability,
} from "@/domains/inventory";
import { getApplianceHistory, getInspectionChecklist } from "@/domains/inventory/guided-actions";
import { formatCents } from "@/domains/pricing";
import { ApplianceDetailPanel } from "./appliance-detail-panel";
import { PartsSection } from "./parts-section";
import { GuidedActionsPanel } from "./guided-actions-panel";
import { HistoryTimeline } from "./history-timeline";
import { ApplianceEarningsSummary } from "@/components/desk/appliance-earnings-summary";

export const metadata = { title: "Appliance" };

export default async function ApplianceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAppliance id={id} />;
  const appliance = await getApplianceById(id);

  if (!appliance) {
    notFound();
  }

  const [partRecords, profitability, history, inspectionChecklist] = await Promise.all([
    appliance.model ? getPartRecordsForModel(appliance.model) : Promise.resolve([]),
    getApplianceProfitability(id),
    getApplianceHistory(id),
    getInspectionChecklist(),
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

      {profitability && <ApplianceEarningsSummary report={profitability} />}

      <div className="mt-6 space-y-6">
        <GuidedActionsPanel
          applianceId={id}
          status={appliance.status}
          inspectionChecklist={inspectionChecklist}
        />
        <ApplianceDetailPanel appliance={appliance} />
        <PartsSection
          modelNumber={appliance.model}
          manufacturer={appliance.manufacturer}
          applianceTypeId={appliance.applianceTypeId}
          partRecords={partRecords}
        />
        <HistoryTimeline entries={history} />
      </div>
    </div>
  );
}

