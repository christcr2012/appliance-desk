import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";
import { getAllApplianceTypes } from "@/domains/settings";
import { businessDateKey } from "@/lib/business-date";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { RecordPurchaseForm } from "./record-purchase-form";

export const metadata = { title: "Record a purchase" };
export const dynamic = "force-dynamic";

export default async function NewPurchasePage() {
  const session = await requireRole("OWNER", "ADMIN");
  const [suppliers, types] = await Promise.all([getSuppliers(), getAllApplianceTypes()]);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Record a purchase"
        description="One receipt, one seller, any number of appliances. Each appliance gets its own record and its own share of the tax."
        secondaryActions={<ButtonLink href="/desk/purchases" variant="secondary">All purchases</ButtonLink>}
      />
      <Card title="Purchase details">
        <RecordPurchaseForm
          operationKey={randomUUID()}
          todayKey={businessDateKey(new Date())}
          isOwner={session.user.role === "OWNER"}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
          applianceTypes={types.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }))}
        />
      </Card>
    </div>
  );
}
