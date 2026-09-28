import { requireRole } from "@/lib/session";
import { AuthedHeader, type AuthedNavLink } from "@/components/authed-header";
import { DeskSidebar } from "@/components/desk-sidebar";
import { IdleLogout } from "@/components/idle-logout";

export const metadata = {
  robots: { index: false, follow: false },
};

const DESK_LINKS: AuthedNavLink[] = [
  { href: "/desk/today", label: "Today" },
  { href: "/desk/dashboard", label: "Dashboard" },
  { href: "/desk/leads", label: "Leads" },
  { href: "/desk/customers", label: "Customers" },
  { href: "/desk/agreements", label: "Agreements" },
  { href: "/desk/billing", label: "Billing" },
  { href: "/desk/revenue", label: "Revenue" },
  { href: "/desk/jobs", label: "Jobs" },
  { href: "/desk/dispatch", label: "Dispatch" },
  { href: "/desk/maintenance", label: "Maintenance" },
  { href: "/desk/inventory", label: "Inventory" },
  { href: "/desk/fleet", label: "Fleet" },
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
    <div className="min-h-screen bg-gray-50 md:flex">
      {/* Mobile only (hamburger + slide-down menu) in this variant — see
          desk-sidebar.tsx's comment for why the desk gets a real sidebar
          on desktop instead of a plain nav row. */}
      <AuthedHeader
        title="Appliance Desk"
        areaLabel="Owner desk"
        links={DESK_LINKS}
        variant="sidebar"
      />
      <DeskSidebar title="Appliance Desk" links={DESK_LINKS} />
      <main id="main-content" className="flex-1 p-6">
        {children}
      </main>
      {/* Owner/admin accounts see every customer's data, so an idle
          desk left open is a bigger risk than an idle customer portal —
          a shorter timeout here (20 min) than /account/** (30 min). */}
      <IdleLogout timeoutMinutes={20} />
    </div>
  );
}
