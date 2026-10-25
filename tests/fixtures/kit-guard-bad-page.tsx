// Test fixture for tests/kit-guards.test.ts — NOT a real page. It breaks each KIT section 9 guard exactly once so the
// guard test can prove every rule fails when it should. Never import it from the app.
import Link from "next/link";
import { Drawer } from "vaul"; // guard 5: Radix/cmdk/vaul outside src/components/kit
import { PageHeader } from "@/components/ui";
import { ScreenHeader } from "@/components/kit"; // guard 4: a list page without DataTable and Toolbar

export default function KitGuardBadPage() {
  return (
    <main>
      <ScreenHeader title="Bills" count={3} />
      {/* guard 1: a page header with a description */}
      <PageHeader title="Bills" description="Every bill you have sent, with what is still owed." />
      {/* guard 2: three bare navigation links in a row */}
      <ul>
        <li><Link href="/desk/billing?status=open">Open bills</Link></li>
        <li><Link href="/desk/billing?status=past-due">Past due bills</Link></li>
        <li><Link href="/desk/billing?status=paid">Paid bills</Link></li>
      </ul>
      {/* guard 3: a visible paragraph longer than 140 characters */}
      <p>This page lists every bill you have ever sent to a customer, including the ones that are paid, the ones that are late and the ones you gave up on.</p>
      <Drawer.Root />
    </main>
  );
}
