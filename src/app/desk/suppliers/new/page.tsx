import { requireRole } from "@/lib/session";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Add a supplier" };

export default async function NewSupplierPage() {
  await requireRole("OWNER", "ADMIN");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add a supplier"
        description="Add a vendor you use for appliances, parts, or other purchasing."
        secondaryActions={
          <ButtonLink href="/desk/suppliers" variant="secondary">
            All suppliers
          </ButtonLink>
        }
      />
      <Card title="Supplier details">
        <SupplierForm />
      </Card>
    </div>
  );
}
