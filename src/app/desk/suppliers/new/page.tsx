import Link from "next/link";
import { requireRole } from "@/lib/session";
import { ButtonLink, Card } from "@/components/ui";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Add a supplier" };

export default async function NewSupplierPage() {
  await requireRole("OWNER", "ADMIN");

  return (
    <div className="max-w-2xl">
      <Link href="/desk/suppliers" className="text-sm text-ink-soft hover:underline">
        &larr; Back to suppliers
      </Link>

      <h1 className="mt-2 text-xl font-semibold">Add a supplier</h1>
      <p className="mt-1 text-sm text-ink-soft">Add a vendor you use for appliances, parts, or other purchasing.</p>
      <Card title="Supplier details">
        <SupplierForm />
      </Card>
    </div>
  );
}
