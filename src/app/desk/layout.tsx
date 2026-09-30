import { requireRole } from "@/lib/session";
import { DeskSidebar } from "@/components/desk-sidebar";
import { IdleLogout } from "@/components/idle-logout";
import { deskNavigation } from "@/lib/desk-navigation";

export const metadata = { robots: { index: false, follow: false } };

export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const groups = deskNavigation((session.user as { role?: string }).role);
  return (
    <>
      <DeskSidebar groups={groups}>{children}</DeskSidebar>
      <IdleLogout timeoutMinutes={20} />
    </>
  );
}
