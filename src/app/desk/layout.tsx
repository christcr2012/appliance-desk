import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import { RegisterDeskServiceWorker } from "@/components/kit/register-sw";
import { DeskShortcuts } from "@/components/kit/shortcuts";
import {
  enforceTwoFactorForDeskPage,
  requireRoleForTwoFactorSetup,
} from "@/lib/session";
import { AppFrame } from "@/components/kit/app-frame";
import { visibleAreas, visibleProfileLinks } from "@/lib/desk-areas";
import { visibleHelpGuides } from "@/lib/help-guides";
import { IdleLogout } from "@/components/idle-logout";
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
  const areas = visibleAreas(role, screens, shown);
  const profileLinks = visibleProfileLinks(role, screens);
  const helpGuides = visibleHelpGuides(role, screens);
  const name = session.user.name?.trim() || session.user.email || "Team member";
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <>
      <AppFrame areas={areas} profileLinks={profileLinks} user={{ name, email: session.user.email, role, initials }} jobRoleScreens={screens} shown={[...shown]} helpGuides={helpGuides}>{children}</AppFrame>
      <IdleLogout timeoutMinutes={20} />
      <RegisterDeskServiceWorker />
      <DeskShortcuts role={role} />
    </>
  );
}
