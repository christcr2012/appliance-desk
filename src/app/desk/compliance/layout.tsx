import { requireRole } from "@/lib/session";
import { TaxesTabs } from "@/app/desk/sales-tax/taxes-tabs";
import { AreaLayout } from "@/components/kit/area-layout";

export const metadata = { title: "Compliance", robots: { index: false, follow: false } };

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  return (
    <AreaLayout area="money"><section className="mx-auto max-w-6xl space-y-5 pb-10">
      <header className="space-y-2 print:hidden">
        <h1 className="text-2xl font-bold text-foreground">Compliance</h1>
        <p className="text-sm text-muted-foreground">
          Every federal, state and city obligation for the business, with its dates and sources. Nothing is
          ever filed or paid without your approval.
        </p>
      </header>
      <TaxesTabs />
      {children}
    </section></AreaLayout>
  );
}
