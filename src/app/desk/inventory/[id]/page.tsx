import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAppliance } from "./operational-appliance";
import { AppliancePurchaseTaxPanel } from "./appliance-purchase-tax-panel";
import { TaxProofPanel } from "./tax-proof-panel";
import { getApplianceTaxProof } from "@/domains/tax/tax-proof";
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
import { CleaningPanel } from "./cleaning-panel";
import { ApplianceEarningsSummary } from "@/components/desk/appliance-earnings-summary";
import { privatePhotoReadPath } from "@/lib/photo-storage";
import { getOpenCustody } from "@/domains/inventory/custody";
import { prisma } from "@/lib/prisma";
import { explainPendingPurchaseTax } from "@/domains/tax/purchase-tax-explain";
import { formatBusinessDate, formatShortDate } from "@/lib/business-date";
import { CustodyPanel } from "./custody-panel";
import { OLD_SET_TYPE_SLUG } from "@/domains/packages/pricing";
import { RecordConnections } from "@/components/desk/record-connections";
import { BudgetContextCard } from "@/domains/budget/context";
import { getSalvagedParts } from "@/domains/inventory/retired-plans";
import { businessDateKey } from "@/lib/business-date";
import { RetiredPlanPanel } from "./retired-plan-panel";
import { RefrigerantPanel } from "./refrigerant-panel";
import { loadRefrigerantPanel } from "@/domains/refrigerant/actions";
import { RecordHeader, StatStrip } from "@/components/kit";
import { Toaster } from "@/components/kit/toaster";
import {
  APPLIANCE_PILL,
  AWAY_FOR_REPAIR_PILL,
  applianceSubtitle,
  applianceTitle,
} from "@/domains/inventory/words";
import { applianceNextStep } from "@/domains/inventory/next-step";
import { RetireApplianceButton } from "./retire-button";
import type { ApplianceStatus } from "@prisma/client";

export const metadata = { title: "Appliance" };

type TabKey = "overview" | "repairs" | "money" | "parts" | "tax" | "retired" | "activity";

const PRIMARY_BY_STATUS: Partial<Record<ApplianceStatus, { label: string; anchor: string }>> = {
  AVAILABLE: { label: "Start a repair…", anchor: "guided-actions" },
  RESERVED: { label: "Start a repair…", anchor: "guided-actions" },
  AWAITING_INSPECTION: { label: "Inspect", anchor: "guided-actions" },
  CLEANING: { label: "Mark cleaned", anchor: "cleaning" },
  MAINTENANCE: { label: "Finish repair", anchor: "guided-actions" },
  RENTED: { label: "Swap it…", anchor: "guided-actions" },
};

export default async function ApplianceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAppliance id={id} />;
  const isOwner = session.user.role === "OWNER";
  const appliance = await getApplianceById(id);

  if (!appliance) {
    notFound();
  }

  // AR-6 fix 8: the record's independent reads run in ONE parallel batch
  // (the page used to await them one after another).
  const [
    awayPeriod,
    openCustody,
    partRecords,
    profitability,
    history,
    inspectionChecklist,
    pendingTax,
    taxProof,
    retiredPlan,
    refrigerantPanel,
    salvagedParts,
  ] = await Promise.all([
    prisma.outOfServicePeriod.findFirst({
      where: { applianceId: id, endedOn: null },
      select: { id: true },
    }),
    getOpenCustody(prisma, id),
    appliance.model ? getPartRecordsForModel(appliance.model) : Promise.resolve([]),
    getApplianceProfitability(id),
    getApplianceHistory(id),
    getInspectionChecklist(),
    appliance.acquisitionTaxStatus === "UNKNOWN"
      ? prisma.$transaction((tx) => explainPendingPurchaseTax(tx, id))
      : Promise.resolve(null),
    isOwner || session.user.role === "ADMIN" ? getApplianceTaxProof(id) : Promise.resolve(null),
    appliance.status === "RETIRED"
      ? prisma.retiredAppliancePlan.findUnique({ where: { applianceId: id } })
      : Promise.resolve(null),
    appliance.status === "RETIRED"
      ? loadRefrigerantPanel(id, new Date(), session.user.role)
      : Promise.resolve(null),
    appliance.status === "RETIRED" ? getSalvagedParts(id) : Promise.resolve([]),
  ]);
  const awayForRepair = awayPeriod !== null;
  const needsCustodyRecord =
    !openCustody && (appliance.status === "RENTED" || appliance.status === "AWAITING_PICKUP");
  // The two reads that depend on the custody episode, together.
  const [custodyCustomer, custodyAddress] = await Promise.all([
    openCustody
      ? prisma.customer.findUnique({
          where: { id: openCustody.customerId },
          select: {
            companyName: true,
            user: { select: { name: true, email: true } },
          },
        })
      : Promise.resolve(null),
    openCustody?.serviceAddressId
      ? prisma.serviceAddress.findUnique({
          where: { id: openCustody.serviceAddressId },
          select: { line1: true, city: true },
        })
      : Promise.resolve(null),
  ]);

  const isOldSet = appliance.applianceType.slug === OLD_SET_TYPE_SLUG && !appliance.archivedAt;
  const nextStep = applianceNextStep(appliance, {
    awayForRepair,
    custodyMissing: needsCustodyRecord,
    retiredPlanMissing: appliance.status === "RETIRED" && !retiredPlan?.choice,
    isOldSet,
  });

  const pill = APPLIANCE_PILL[appliance.status];
  const where = openCustody && custodyCustomer
    ? `With ${custodyCustomer.companyName ?? custodyCustomer.user.name ?? custodyCustomer.user.email}${custodyAddress ? `, ${custodyAddress.city}` : ""}`
    : (appliance.currentLocation ?? "At the shop");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "repairs", label: "Repairs and visits" },
    { key: "money", label: "Money" },
    { key: "parts", label: "Parts" },
    ...(isOwner ? [{ key: "tax", label: "Tax" } as { key: TabKey; label: string }] : []),
    ...(appliance.status === "RETIRED"
      ? [{ key: "retired", label: "Retired" } as { key: TabKey; label: string }]
      : []),
    { key: "activity", label: "Activity" },
  ];
  const rawTab = (await searchParams).tab as TabKey | undefined;
  const tab: TabKey = rawTab && tabs.some((t) => t.key === rawTab) ? rawTab : "overview";

  const primary = PRIMARY_BY_STATUS[appliance.status];
  const repairEntries = history.filter((e) => e.kind === "job" || e.kind === "inspection");

  return (
    <div className="max-w-2xl">
      <Toaster />
      <RecordHeader
        title={applianceTitle(appliance)}
        subtitle={applianceSubtitle(appliance)}
        back={{ href: "/desk/inventory", label: "Fleet" }}
        pills={[
          {
            label: pill.label,
            tone: pill.tone,
            info: appliance.status === "AWAITING_INSPECTION" ? "awaiting-inspection" : undefined,
          },
          ...(awayForRepair
            ? [{ label: AWAY_FOR_REPAIR_PILL.label, tone: AWAY_FOR_REPAIR_PILL.tone, info: "away-for-repair" as const }]
            : []),
        ]}
        primary={
          primary
            ? {
                kind: "link",
                label: primary.label,
                href: `/desk/inventory/${id}?tab=overview#${primary.anchor}`,
              }
            : undefined
        }
        actions={[
          { kind: "link", label: "Print QR label", href: `/desk/inventory/${id}/qr` },
        ]}
        overflow={[
          { kind: "link", label: "Edit details", href: `/desk/inventory/${id}?tab=overview#details` },
          ...(isOldSet
            ? [{ kind: "link", label: "Split it into separate machines", href: `/desk/inventory/${id}/split` } as const]
            : []),
        ]}
      />
      <p className="mt-2 text-sm text-ink-soft">
        Added {new Date(appliance.createdAt).toLocaleDateString()}
        {appliance.purchaseDate ? ` · purchased ${formatBusinessDate(appliance.purchaseDate)}` : ""}
      </p>

      <div className="mt-4">
        <StatStrip
          items={[
            { label: "Status", value: pill.label },
            { label: "Where", value: where },
            {
              label: "Earned",
              value: profitability ? formatCents(profitability.revenueCents) : "—",
              info: "equipment-value",
            },
            {
              label: "Cost",
              value:
                appliance.acquisitionCostCents !== null
                  ? formatCents(appliance.acquisitionCostCents)
                  : "Not entered",
            },
            {
              label: "In service since",
              value: formatShortDate(appliance.purchaseDate ?? appliance.createdAt),
            },
          ]}
        />
      </div>

      {appliance.status !== "RETIRED" && (
        <div className="mt-3 flex justify-end">
          <RetireApplianceButton applianceId={id} />
        </div>
      )}

      {nextStep && (
        <Link
          href={nextStep.href}
          className={`mt-4 block rounded-card border p-3 text-sm font-semibold text-ink ${
            nextStep.tone === "attention"
              ? "border-attention bg-attention/10"
              : "border-line bg-subtle"
          }`}
        >
          Next step: {nextStep.label} →
        </Link>
      )}
      {awayForRepair && (
        <p className="mt-2 text-sm text-ink-soft">
          Taken for repair with no replacement yet, so the customer will be credited the days
          without it.
        </p>
      )}

      <nav aria-label="Appliance sections" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/desk/inventory/${id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm font-semibold ${
              tab === t.key
                ? "border-b-2 border-primary text-ink"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 space-y-6">
        {tab === "overview" && (
          <>
            <CustodyPanel
              applianceId={id}
              canRecord
              needsRecord={needsCustodyRecord}
              current={
                openCustody && custodyCustomer
                  ? {
                      customerId: openCustody.customerId,
                      customerName:
                        custodyCustomer.companyName ??
                        custodyCustomer.user.name ??
                        custodyCustomer.user.email,
                      since: openCustody.startedOn ? formatBusinessDate(openCustody.startedOn) : null,
                      address: custodyAddress ? `${custodyAddress.line1}, ${custodyAddress.city}` : null,
                    }
                  : null
              }
            />
            <div id="cleaning">
              <CleaningPanel applianceId={id} status={appliance.status} />
            </div>
            <div id="guided-actions">
              <GuidedActionsPanel
                applianceId={id}
                status={appliance.status}
                inspectionChecklist={inspectionChecklist}
              />
            </div>
            <div id="details">
              <ApplianceDetailPanel
                appliance={{
                  ...appliance,
                  photos: appliance.photos.map((photo) => ({
                    ...photo,
                    url: privatePhotoReadPath(photo.id),
                  })),
                }}
              />
            </div>
          </>
        )}

        {tab === "repairs" && <HistoryTimeline entries={repairEntries} />}

        {tab === "money" && (
          <>
            {profitability && <ApplianceEarningsSummary report={profitability} />}
            <BudgetContextCard userId={session.user.id} heading="Appliance replacement savings and budget" />
          </>
        )}

        {tab === "parts" && (
          <PartsSection
            modelNumber={appliance.model}
            manufacturer={appliance.manufacturer}
            applianceTypeId={appliance.applianceTypeId}
            partRecords={partRecords}
          />
        )}

        {tab === "tax" && isOwner && (
          <>
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
            {taxProof && <TaxProofPanel proof={taxProof} />}
          </>
        )}

        {tab === "retired" && appliance.status === "RETIRED" && (
          <>
            <RetiredPlanPanel
              applianceId={id}
              plan={retiredPlan ? {
                choice: retiredPlan.choice, note: retiredPlan.note, remainder: retiredPlan.remainder,
                doneOn: retiredPlan.doneOn ? businessDateKey(retiredPlan.doneOn) : null, doneNote: retiredPlan.doneNote, reopenReason: retiredPlan.reopenReason,
              } : null}
              salvaged={salvagedParts.map((m) => ({
                id: m.id, quantity: m.quantityDelta,
                label: `${m.partRecord.partName?.trim() || `Part ${m.partRecord.partNumber}`} (${m.partRecord.modelNumber})`,
              }))}
              today={businessDateKey(new Date())}
              isOwner={isOwner}
            />
            {refrigerantPanel && (
              <RefrigerantPanel
                applianceId={id}
                today={businessDateKey(new Date())}
                locked={refrigerantPanel.locked}
                keepYears={refrigerantPanel.years}
                keepUntilText={refrigerantPanel.keepUntil ? businessDateKey(refrigerantPanel.keepUntil) : null}
                isOwner={isOwner}
                receiptRecord={refrigerantPanel.receiptRecord}
                record={refrigerantPanel.record ? {
                  refrigerantType: refrigerantPanel.record.refrigerantType, outcome: refrigerantPanel.record.outcome,
                  recoveredByName: refrigerantPanel.record.recoveredByName, recoveredByAddress: refrigerantPanel.record.recoveredByAddress,
                  certificationNumber: refrigerantPanel.record.certificationNumber, equipmentUsed: refrigerantPanel.record.equipmentUsed,
                  recoveredOn: businessDateKey(refrigerantPanel.record.recoveredOn), recyclerName: refrigerantPanel.record.recyclerName,
                  receiptReference: refrigerantPanel.record.receiptReference,
                } : null}
              />
            )}
          </>
        )}

        {tab === "activity" && (
          <>
            <HistoryTimeline entries={history} />
            <RecordConnections kind="appliance" id={id} showHistory={false} />
          </>
        )}
      </div>
    </div>
  );
}
