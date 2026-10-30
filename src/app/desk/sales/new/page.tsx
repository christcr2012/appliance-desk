import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSaleFormData } from "@/domains/sales";
import { EmptyState } from "@/components/ui";
import { NewSaleForm } from "./new-sale-form";

export const metadata = { title: "New sale" };

export default async function NewSalePage() {
  const session = await requireRole("OWNER", "ADMIN");
  const { parts, customers, usedAppliances } = await getSaleFormData(session.user.id);
  return (
    <main className="space-y-6">
      <Link href="/desk/sales" className="text-sm text-ink-soft hover:underline">
        &larr; Back to all sales
      </Link>

      <h1 className="mt-2 text-xl font-semibold">New sale</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Pick what is being sold, who it is for, and whether it is picked up or delivered. The sales tax is figured for you.
      </p>
      {parts.length === 0 && usedAppliances.length === 0 ? (
        <EmptyState
          title="Nothing is ready to sell"
          description="Open a part on the Parts screen and choose “Sell to customers” to set its price. Used appliances sell from the retired list."
          action={<Link href="/desk/parts" className="underline">Go to Parts</Link>}
        />
      ) : (
        <NewSaleForm
          parts={parts.map((p) => ({
            id: p.id,
            label: `${p.partName?.trim() || `Part ${p.partNumber}`} (${p.modelNumber})`,
            onHand: p.quantityOnHand,
            retailPriceCents: p.retailPriceCents,
          }))}
          usedAppliances={usedAppliances.map((a) => ({
            id: a.id,
            label: `${[a.manufacturer, a.model].filter(Boolean).join(" ") || a.applianceType.name} — ${a.assetNumber}${a.serialNumber ? `, serial ${a.serialNumber}` : ""}`,
            bookValueCents: a.bookAsset?.retiredValueCents ?? null,
            evidence: a.bookAsset?.taxEvidence[0] ?? null,
          }))}
          customers={customers.map((c) => ({
            id: c.id,
            label: c.user.name?.trim() || c.user.email,
            addresses: c.serviceAddresses.map((a) => ({ id: a.id, label: `${a.line1}${a.unitLabel ? ` ${a.unitLabel}` : ""}, ${a.city} ${a.zip}` })),
          }))}
        />
      )}
    </main>
  );
}
