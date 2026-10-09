import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAppliance } from "./operational-appliance";
import { AppliancePurchaseTaxPanel } from "./appliance-purchase-tax-panel";
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
import { explainPendingPurchaseTax } from "@/domains/tax/purchase-tax-explain";
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
  const pendingTax = appliance.acquisitionTaxStatus === "UNKNOWN"
    ? await prisma.$transaction(tx => explainPendingPurchaseTax(tx, id))
    : null;
  const custodyAddress = openCustody?.serviceAddressId
    ? await prisma.serviceAddress.findUnique({ where: { id: openCustody.serviceAddressId }, select: { line1: true, city: true } })
    : null;

  return (
    <div className="max-w-2xl">
      <Link href="/desk/inventory" className="text-sm text-ink-soft hover:underline">
        &larr; Back to inventory
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {appliance.assetNumber} — {appliance.applianceType.name}
        </h1>
        <Link
          href={`/desk/inventory/${id}/qr`}
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong"
        >
          Print QR label
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
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
        {session.user.role === "OWNER" && (
          <AppliancePurchaseTaxPanel appliance={{
            id: appliance.id,
            acquisitionTaxStatus: appliance.acquisitionTaxStatus,
            acquisitionTaxChoice: appliance.acquisitionTaxChoice,
            acquisitionTaxPaidCents: appliance.acquisitionTaxPaidCents,
            acquisitionSellerNote: appliance.acquisitionSellerNote,
            acquisitionReceiptPhotoId: appliance.acquisitionReceiptPhotoId,
            acquisitionTaxRecordedAt: appliance.acquisitionTaxRecordedAt?.toISOString() ?? null,
            hasPurchaseContext: appliance.purchaseDate !== null && appliance.acquisitionCostCents !== null,
            pendingTax,
            photos: appliance.photos.map((photo, index) => ({
              id: photo.id,
              description: photo.altText || `Appliance photo ${index + 1}`,
            })),
          }} />
        )}
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

