import { requireRole } from "@/lib/session";
import { AuthedHeader, type AuthedNavLink } from "@/components/authed-header";

export const metadata = {
  robots: { index: false, follow: false },
};

const DESK_LINKS: AuthedNavLink[] = [
  { href: "/desk/dashboard", label: "Dashboard" },
  { href: "/desk/leads", label: "Leads" },
  { href: "/desk/customers", label: "Customers" },
  { href: "/desk/agreements", label: "Agreements" },
  { href: "/desk/billing", label: "Billing" },
  { href: "/desk/jobs", label: "Jobs" },
  { href: "/desk/maintenance", label: "Maintenance" },
  { href: "/desk/inventory", label: "Inventory" },
  { href: "/desk/parts", label: "Parts" },
  { href: "/desk/activity", label: "Activity" },
  { href: "/desk/settings", label: "Settings" },
];

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
      <AuthedHeader title="Appliance Desk" areaLabel="Owner desk" links={DESK_LINKS} />
      <main id="main-content" className="p-6">
        {children}
      </main>
    </div>
  );
}
