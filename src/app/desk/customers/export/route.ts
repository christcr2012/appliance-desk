import { requireRole } from "@/lib/session";
import { getCustomers } from "@/domains/customers";
import { toCsv } from "@/lib/csv";

/** CSV export of the full customer roster — a real download, not a
 * capped list like the on-screen page, since this is meant for
 * spreadsheet/accounting use outside the app. */
export async function GET() {
  await requireRole("OWNER", "ADMIN");

  const customers = await getCustomers();

  const csv = toCsv(
    [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
      { key: "phone", header: "Phone" },
      { key: "companyName", header: "Company" },
      { key: "isPropertyManager", header: "Property manager" },
      { key: "propertyCount", header: "Properties on file" },
      { key: "agreementCount", header: "Agreements" },
      { key: "createdAt", header: "Added" },
    ],
    customers.map((c) => ({
      name: c.user.name ?? "",
      email: c.user.email,
      phone: c.phone ?? "",
      companyName: c.companyName ?? "",
      isPropertyManager: c.isPropertyManager ? "Yes" : "No",
      propertyCount: c.serviceAddresses.length,
      agreementCount: c._count.rentalAgreements,
      createdAt: c.createdAt.toISOString().slice(0, 10),
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
