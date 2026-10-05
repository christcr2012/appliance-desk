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
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { getOpenCustody } from "@/domains/inventory/custody";
import { getCustomers } from "@/domains/customers";
import { prisma } from "@/lib/prisma";
import { formatBusinessDate } from "@/lib/business-date";
import { CustodyPanel } from "./custody-panel";

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

  const openCustody = await getOpenCustody(prisma, id);
  const needsCustodyRecord =
    !openCustody && (appliance.status === "RENTED" || appliance.status === "AWAITING_PICKUP");
  const [partRecords, profitability, history, inspectionChecklist, custodyCustomer, customers] = await Promise.all([
    appliance.model ? getPartRecordsForModel(appliance.model) : Promise.resolve([]),
    getApplianceProfitability(id),
    getApplianceHistory(id),
    getInspectionChecklist(),
    openCustody
      ? prisma.customer.findUnique({
          where: { id: openCustody.customerId },
          select: { user: { select: { name: true, email: true } } },
        })
      : Promise.resolve(null),
    needsCustodyRecord ? getCustomers() : Promise.resolve([]),
  ]);
  const custodyAddress = openCustody?.serviceAddressId
    ? await prisma.serviceAddress.findUnique({ where: { id: openCustody.serviceAddressId }, select: { line1: true, city: true } })
    : null;

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
          ` · purchased ${formatBusinessDate(appliance.purchaseDate)}`}
      </p>

      {profitability && <ApplianceEarningsSummary report={profitability} />}

      <div className="mt-6 space-y-6">
        <CustodyPanel
          applianceId={id}
          canRecord
          needsRecord={needsCustodyRecord}
          current={
            openCustody && custodyCustomer
              ? {
                  customerId: openCustody.customerId,
                  customerName: custodyCustomer.user.name ?? custodyCustomer.user.email,
                  since: openCustody.startedOn ? formatBusinessDate(openCustody.startedOn) : null,
                  address: custodyAddress ? `${custodyAddress.line1}, ${custodyAddress.city}` : null,
                }
              : null
          }
          customers={customers.map((c) => ({
            id: c.id,
            name: c.user.name ?? c.user.email,
            serviceAddresses: c.serviceAddresses.map((a) => ({ id: a.id, label: `${a.line1}, ${a.city}` })),
          }))}
        />
        <GuidedActionsPanel
          applianceId={id}
          status={appliance.status}
          inspectionChecklist={inspectionChecklist}
        />
        <ApplianceDetailPanel
          appliance={{
            ...appliance,
            photos: appliance.photos.map((photo) => ({
              ...photo,
              url: privatePhotoReadPath(photo.id),
            })),
          }}
        />
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

