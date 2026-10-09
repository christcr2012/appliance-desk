import Link from "next/link";
import { requireRole } from "@/lib/session";
export const metadata = { title: "Sales tax", robots: { index: false, follow: false } };
const sections = [
  { title: "Overview", href: "/desk/sales-tax", ready: false },
  { title: "Returns", href: "/desk/sales-tax/returns", ready: false },
  { title: "Areas", href: "/desk/sales-tax/areas", ready: false },
  { title: "Exemptions", href: "/desk/sales-tax/exemptions", ready: false },
  { title: "What's taxed", href: "/desk/sales-tax/taxability", ready: true },
  { title: "Setup", href: "/desk/sales-tax/setup", ready: true },
];
export default async function SalesTaxLayout({ children }: { children: React.ReactNode }) {
  await requireRole("OWNER", "ADMIN");
  return <section className="mx-auto max-w-6xl space-y-5 pb-10">
    <header className="space-y-2">
      <h1 className="text-2xl font-bold text-foreground">Sales tax</h1>
      <p className="text-sm text-muted-foreground">Colorado sales, use and retail delivery fee setup. Filing and payments remain owner-controlled.</p>
    </header>
    <nav aria-label="Sales tax sections" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {sections.map(section => section.ready ?
        <Link key={section.href} href={section.href} className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{section.title}</Link> :
        <span key={section.href} aria-disabled="true" title="Not yet released" className="rounded-lg border border-border/50 px-3 py-2 text-sm text-muted-foreground">{section.title}</span>)}
    </nav>
    {children}
  </section>;
}

