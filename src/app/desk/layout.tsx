import Link from "next/link";
import { requireRole } from "@/lib/session";

export const metadata = {
  robots: { index: false, follow: false },
};

// Every /desk/** page requires OWNER or ADMIN. This check happens again
// inside requireRole() on the server — the proxy cookie check is
// only a fast first pass, not the real gate.
export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("OWNER", "ADMIN");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <span className="font-semibold">Appliance Desk</span>
        <nav aria-label="Owner desk" className="flex gap-4 text-sm">
          <Link href="/desk/dashboard" className="text-gray-600 hover:text-gray-900">
            Dashboard
          </Link>
          <Link href="/desk/leads" className="text-gray-600 hover:text-gray-900">
            Leads
          </Link>
          <Link href="/desk/customers" className="text-gray-600 hover:text-gray-900">
            Customers
          </Link>
          <Link href="/desk/agreements" className="text-gray-600 hover:text-gray-900">
            Agreements
          </Link>
          <Link href="/desk/billing" className="text-gray-600 hover:text-gray-900">
            Billing
          </Link>
          <Link href="/desk/jobs" className="text-gray-600 hover:text-gray-900">
            Jobs
          </Link>
          <Link href="/desk/maintenance" className="text-gray-600 hover:text-gray-900">
            Maintenance
          </Link>
          <Link href="/desk/inventory" className="text-gray-600 hover:text-gray-900">
            Inventory
          </Link>
          <Link href="/desk/parts" className="text-gray-600 hover:text-gray-900">
            Parts
          </Link>
          <Link href="/desk/activity" className="text-gray-600 hover:text-gray-900">
            Activity
          </Link>
          <Link href="/desk/settings" className="text-gray-600 hover:text-gray-900">
            Settings
          </Link>
        </nav>
      </header>
      <main id="main-content" className="p-6">
        {children}
      </main>
    </div>
  );
}
