import { requireRole } from "@/lib/session";

export const metadata = {
  robots: { index: false, follow: false },
};

// Every /desk/** page requires OWNER or ADMIN. This check happens again
// inside requireRole() on the server — the middleware cookie check is
// only a fast first pass, not the real gate.
export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("OWNER", "ADMIN");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <span className="font-semibold">Appliance Desk</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
