import { headers } from "next/headers";
import {
  enforceTwoFactorForDeskPage,
  requireRoleForTwoFactorSetup,
} from "@/lib/session";
import { AppShell } from "@/components/ui";
import { IdleLogout } from "@/components/idle-logout";
import { Toaster } from "@/components/kit";
import { deskNavigation } from "@/lib/desk-navigation";
import { enforceJobRoleScreen, jobRoleScreens } from "@/lib/job-role-guard";
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
  await enforceJobRoleScreen(session.user.id, role);
  const groups = deskNavigation(role, await jobRoleScreens(session.user.id, role));
  return (
    <>
      <AppShell nav={groups} role={role}>{children}</AppShell>
      <IdleLogout timeoutMinutes={20} />
      {/* KIT 4.15: the one toast region for every desk screen. */}
      <Toaster />
    </>
  );
}
