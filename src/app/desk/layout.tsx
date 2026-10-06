import { requireRole } from "@/lib/session";
import { AppShell } from "@/components/ui";
import { IdleLogout } from "@/components/idle-logout";
import { deskNavigation } from "@/lib/desk-navigation";

export const metadata = { robots: { index: false, follow: false } };

export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role ?? "";
  const groups = deskNavigation(role);
  return (
    <>
      <AppShell nav={groups} role={role}>{children}</AppShell>
      <IdleLogout timeoutMinutes={20} />
    </>
  );
}
