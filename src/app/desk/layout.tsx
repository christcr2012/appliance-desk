import { headers } from "next/headers";
import {
  enforceTwoFactorForDeskPage,
  requireRoleForTwoFactorSetup,
} from "@/lib/session";
import { AppShell } from "@/components/ui";
import { IdleLogout } from "@/components/idle-logout";
import { deskNavigation } from "@/lib/desk-navigation";
import { isTwoFactorEnrollmentExemptPath } from "@/domains/security/two-factor";

export const metadata = { robots: { index: false, follow: false } };

export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRoleForTwoFactorSetup("OWNER", "ADMIN", "STAFF");
  const role = session.user.role;
  const pathname = (await headers()).get("x-appliance-pathname");
  if (!isTwoFactorEnrollmentExemptPath(pathname)) {
    await enforceTwoFactorForDeskPage(session);
  }
  const groups = deskNavigation(role);
  return (
    <>
      <AppShell nav={groups} role={role}>{children}</AppShell>
      <IdleLogout timeoutMinutes={20} />
    </>
  );
}
