import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSuppliers } from "@/domains/purchasing";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  await requireRole("OWNER", "ADMIN");
  const suppliers = await getSuppliers();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Suppliers</h1>
        <Link
          href="/desk/suppliers/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + Add supplier
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        Who you order parts and appliances from.
      </p>

      {suppliers.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600">No suppliers on file yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {suppliers.map((s) => (
            <li key={s.id}>
              <Link
                href={`/desk/suppliers/${s.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">{s.name}</p>
                  <p className="text-sm text-gray-600">
                    {s.contactName ?? ""}
                    {s.contactName && (s.phone || s.email) ? " · " : ""}
                    {s.phone ?? ""}
                    {s.phone && s.email ? " · " : ""}
                    {s.email ?? ""}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>
                    {s._count.purchaseOrders} purchase{" "}
                    {s._count.purchaseOrders === 1 ? "order" : "orders"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
