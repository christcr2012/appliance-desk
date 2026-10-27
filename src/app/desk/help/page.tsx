import { requireRole } from "@/lib/session";
import { jobRoleScreens } from "@/lib/job-role-guard";
import { visibleHelpGuides } from "@/lib/help-guides";
import { HelpGuidesList } from "./help-guides-list";

export const metadata = { title: "How do I…?" };

export default async function HelpPage() {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const guides = visibleHelpGuides(
    session.user.role,
    await jobRoleScreens(session.user.id, session.user.role),
  );
  return <HelpGuidesList guides={guides} />;
}
