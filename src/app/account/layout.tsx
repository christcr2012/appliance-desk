import { requireSession } from "@/lib/session";
import { AuthedHeader, type AuthedNavLink } from "@/components/authed-header";

export const metadata = {
  robots: { index: false, follow: false },
};

const ACCOUNT_LINKS: AuthedNavLink[] = [
  { href: "/account", label: "Overview" },
  { href: "/account/rentals", label: "My rentals" },
  { href: "/account/maintenance", label: "Maintenance" },
  { href: "/account/billing", label: "Billing" },
];

// Any signed-in user can reach /account — a customer sees their own
// rentals, an owner/admin can still have an account of their own. What
// DATA shows up inside each page is filtered by the signed-in user's id
// on the server (see docs/BUSINESS-RULES.md — "a customer must never see
// another customer's records").
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();

  return (
    <div className="min-h-screen bg-gray-50">
      <AuthedHeader title="My Account" areaLabel="My account" links={ACCOUNT_LINKS} />
      <main id="main-content" className="p-6">
        {children}
      </main>
    </div>
  );
}
