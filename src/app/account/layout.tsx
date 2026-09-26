import Link from "next/link";
import { requireSession } from "@/lib/session";

export const metadata = {
  robots: { index: false, follow: false },
};

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
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <span className="font-semibold">My Account</span>
        <nav aria-label="My account" className="flex gap-4 text-sm">
          <Link href="/account" className="text-gray-600 hover:text-gray-900">
            Overview
          </Link>
          <Link href="/account/rentals" className="text-gray-600 hover:text-gray-900">
            My rentals
          </Link>
          <Link href="/account/maintenance" className="text-gray-600 hover:text-gray-900">
            Maintenance
          </Link>
        </nav>
      </header>
      <main id="main-content" className="p-6">
        {children}
      </main>
    </div>
  );
}
