// AR-8 (SETTINGS spec section 2): every settings page renders inside the
// SettingsLayout frame. The layout is NOT the guard — each page still
// calls its own requireRole; this only checks enough to shape the frame
// and work out which sections have a setting waiting (the attention dot).

import type { ReactNode } from "react";
import { requireRole } from "@/lib/session";
import { SettingsLayout } from "@/components/kit/settings-layout";
import { ALL_SETTING_ROWS, type SettingsSectionId } from "@/domains/settings/catalog";
import { listDecisions } from "@/domains/decisions";

export default async function DeskSettingsLayout({ children }: { children: ReactNode }) {
  const session = await requireRole("OWNER", "ADMIN");
  const attention = new Set<SettingsSectionId>();
  const cards = await listDecisions(session.user.id).catch(() => []);
  const startingIds = new Set<string>();
  for (const card of cards) {
    if (card.state !== "STARTING_VALUE") continue;
    startingIds.add(card.id);
    for (const legacy of card.legacyIds ?? []) startingIds.add(legacy);
  }
  if (startingIds.size > 0) {
    attention.add("decisions");
    for (const row of ALL_SETTING_ROWS) {
      if (row.decisionId && startingIds.has(row.decisionId)) attention.add(row.section);
    }
  }
  return <SettingsLayout attention={[...attention]}>{children}</SettingsLayout>;
}
