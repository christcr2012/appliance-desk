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
