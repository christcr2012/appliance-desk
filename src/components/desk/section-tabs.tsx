import { getServerSession } from "@/lib/session";
import { deskSectionTabs, DESK_SECTIONS, type DeskSectionKey } from "@/lib/desk-sections";
import { SectionTabsNav } from "./section-tabs-nav";

/** Tabs for one desk section (Schedule, Equipment, Money). Role-filtered on the server. */
export async function SectionTabs({ section }: { section: DeskSectionKey }) {
  const session = await getServerSession();
  const tabs = deskSectionTabs(section, session?.user.role);
  if (tabs.length < 2) return null;
  return <SectionTabsNav label={`${DESK_SECTIONS[section].label} sections`} tabs={tabs} />;
}
