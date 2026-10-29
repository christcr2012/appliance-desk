import { requireRole } from "@/lib/session";
import { TaxesTabs } from "./taxes-tabs";
import { AreaLayout } from "@/components/kit/area-layout";
export const metadata = { title: "Taxes", robots: { index: false, follow: false } };
// AR-7: every Taxes page renders inside the Money area with the Taxes sub-tab strip on top.
// Each page carries its own kit ScreenHeader; the old layout header paragraph is gone (the
// Overview's explanation now sits behind its title InfoTip, per BOOKS-TAXES 2.1).
export default async function TaxesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  return <AreaLayout area="money"><section className="mx-auto max-w-6xl space-y-5 pb-10">
    <TaxesTabs />
    {children}
  </section></AreaLayout>;
}
