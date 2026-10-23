import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSaleFormData } from "@/domains/sales";
import { EmptyState, PageHeader } from "@/components/ui";
import { NewSaleForm } from "./new-sale-form";

export const metadata = { title: "New sale" };

export default async function NewSalePage() {
  const session = await requireRole("OWNER", "ADMIN");
  const { parts, customers } = await getSaleFormData(session.user.id);
  return (
    <main className="space-y-6">
      <PageHeader
        title="New sale"
        description="Pick what is being sold, who it is for, and whether it is picked up or delivered. The sales tax is figured for you."
        secondaryActions={<Link href="/desk/sales" className="text-sm underline">Back to all sales</Link>}
      />
      {parts.length === 0 ? (
        <EmptyState
          title="Nothing is ready to sell"
          description="On the Parts screen, open a part you have on the shelf and choose “Sell to customers”, then set a price."
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
