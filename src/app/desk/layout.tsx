import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import { RegisterDeskServiceWorker } from "@/components/kit/register-sw";
import { DeskShortcuts } from "@/components/kit/shortcuts";
import {
  enforceTwoFactorForDeskPage,
  requireRoleForTwoFactorSetup,
} from "@/lib/session";
import { AppShell } from "@/components/ui";
import { IdleLogout } from "@/components/idle-logout";
import { deskNavigation } from "@/lib/desk-navigation";
import { getShownFeatures } from "@/domains/features";
import { enforceJobRoleScreen, jobRoleScreens } from "@/lib/job-role-guard";
import { isTwoFactorEnrollmentExemptPath } from "@/domains/security/two-factor";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  manifest: "/desk.webmanifest",
  title: { default: "Appliance Desk", template: "%s · Appliance Desk" },
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#123C2D" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1e16" },
  ],
  viewportFit: "cover",
};

export default async function DeskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRoleForTwoFactorSetup("OWNER", "ADMIN", "STAFF", "ACCOUNTANT");
  const role = session.user.role;
  const pathname = (await headers()).get("x-appliance-pathname");
  if (!isTwoFactorEnrollmentExemptPath(pathname)) {
    await enforceTwoFactorForDeskPage(session);
  }
  await enforceJobRoleScreen(session.user.id, role);
  const [screens, shown] = await Promise.all([jobRoleScreens(session.user.id, role), getShownFeatures()]);
  const groups = deskNavigation(role, screens, shown);
  return (
    <>
      <AppShell nav={groups} role={role}>{children}</AppShell>
      <IdleLogout timeoutMinutes={20} />
      <RegisterDeskServiceWorker />
      <DeskShortcuts role={role} />
    </>
  );
}
