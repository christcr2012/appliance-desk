import Link from "next/link";
import { requireRole } from "@/lib/session";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Add a supplier" };

export default async function NewSupplierPage() {
  await requireRole("OWNER", "ADMIN");

  return (
    <div className="max-w-lg">
      <Link href="/desk/suppliers" className="text-sm text-ink-soft hover:underline">
        &larr; All suppliers
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Add a supplier</h1>
      <div className="mt-4">
        <SupplierForm />
      </div>
    </div>
  );
}
