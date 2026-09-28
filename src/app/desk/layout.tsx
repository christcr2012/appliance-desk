import { requireRole } from "@/lib/session";
import { AuthedHeader, type AuthedNavLink } from "@/components/authed-header";
import { DeskSidebar } from "@/components/desk-sidebar";
import { IdleLogout } from "@/components/idle-logout";
import { GlobalSearchBox } from "@/components/global-search-box";

export const metadata = {
  robots: { index: false, follow: false },
};

// Links every OWNER/ADMIN/STAFF login sees.
const OPERATIONAL_LINKS: AuthedNavLink[] = [
  { href: "/desk/today", label: "Today" },
  { href: "/desk/driver", label: "Driver view" },
  { href: "/desk/leads", label: "Leads" },
  { href: "/desk/customers", label: "Customers" },
  { href: "/desk/agreements", label: "Agreements" },
  { href: "/desk/jobs", label: "Jobs" },
  { href: "/desk/dispatch", label: "Dispatch" },
  { href: "/desk/maintenance", label: "Maintenance" },
  { href: "/desk/inventory", label: "Inventory" },
  { href: "/desk/fleet", label: "Fleet" },
  { href: "/desk/parts", label: "Parts" },
  { href: "/desk/activity", label: "Activity" },
];

// Business-performance/financial and settings links — OWNER/ADMIN only.
// Each of these pages also calls requireRole("OWNER", "ADMIN") itself;
// this list only controls whether the link is shown, never the real
// gate (see src/lib/session.ts's own comment on requireRole).
const OWNER_ONLY_LINKS: AuthedNavLink[] = [
  { href: "/desk/dashboard", label: "Dashboard" },
  { href: "/desk/billing", label: "Billing" },
  { href: "/desk/revenue", label: "Revenue" },
  { href: "/desk/reports", label: "Reports" },
  { href: "/desk/growth", label: "Growth" },
  { href: "/desk/settings", label: "Settings" },
];

// Every /desk/** page requires OWNER, ADMIN, or STAFF. This check
// happens again inside requireRole() on the server — the proxy cookie
// check is only a fast first pass, not the real gate. A STAFF login
// gets the same layout but a shorter nav — see OWNER_ONLY_LINKS above,
// and each financial/settings page's own requireRole("OWNER", "ADMIN")
// call, which is the actual enforcement.
export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role;
  const isOwnerOrAdmin = role === "OWNER" || role === "ADMIN";
  const links = isOwnerOrAdmin
    ? [...OPERATIONAL_LINKS, ...OWNER_ONLY_LINKS]
    : OPERATIONAL_LINKS;

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      {/* Mobile only (hamburger + slide-down menu) in this variant — see
          desk-sidebar.tsx's comment for why the desk gets a real sidebar
          on desktop instead of a plain nav row. */}
      <AuthedHeader
        title="Appliance Desk"
        areaLabel="Owner desk"
        links={links}
        variant="sidebar"
      />
      <DeskSidebar title="Appliance Desk" links={links} />
      <main id="main-content" className="flex-1 p-6">
        <div className="mb-4 flex justify-end">
          <GlobalSearchBox />
        </div>
        {children}
      </main>
      {/* Owner/admin accounts see every customer's data, so an idle
          desk left open is a bigger risk than an idle customer portal —
          a shorter timeout here (20 min) than /account/** (30 min). */}
      <IdleLogout timeoutMinutes={20} />
    </div>
  );
}
