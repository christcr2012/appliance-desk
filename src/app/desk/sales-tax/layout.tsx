import { requireRole } from "@/lib/session";
import { TaxesTabs } from "./taxes-tabs";
export const metadata = { title: "Taxes", robots: { index: false, follow: false } };
export default async function TaxesLayout({ children }: { children: React.ReactNode }) {
  await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  return <section className="mx-auto max-w-6xl space-y-5 pb-10">
    <header className="space-y-2 print:hidden">
      <h1 className="text-2xl font-bold text-foreground">Taxes</h1>
      <p className="text-sm text-muted-foreground">What to file and pay, use tax, rates and your tax setup in one place. Filing and payments stay in your hands: the app never files a return or pays tax for you.</p>
    </header>
    <TaxesTabs />
    {children}
  </section>;
}
