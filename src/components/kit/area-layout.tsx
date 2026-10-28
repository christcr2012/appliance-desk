import { getServerSession } from "@/lib/session";
import { jobRoleScreens } from "@/lib/job-role-guard";
import { getShownFeatures } from "@/domains/features";
import { visibleAreas, type AreaKey } from "@/lib/desk-areas";
import { AreaTabs } from "./area-tabs";

export async function AreaLayout({ area, children }: { area: AreaKey; children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) return <>{children}</>;
  const [screens, shown] = await Promise.all([
    jobRoleScreens(session.user.id, session.user.role), getShownFeatures(),
  ]);
  const selected = visibleAreas(session.user.role, screens, shown).find(a => a.key === area);
  if (!selected || selected.tabs.length < 2) return <>{children}</>;
  return <>
    <AreaTabs label={selected.label + " sections"} items={selected.tabs.map(t => ({ href: t.href, label: t.label, matches: t.matches, query: t.query }))} />
    {children}
  </>;
}
