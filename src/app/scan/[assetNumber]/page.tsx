import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/session";
import { getActiveApplianceOptionsForUser } from "@/domains/agreements/active-appliances";

export const metadata = {
  title: "Scan appliance",
  robots: { index: false, follow: false },
};

/**
 * Where every appliance's QR code label points
 * (/desk/inventory/[id]/qr generates the printable label). One URL, three
 * outcomes depending on who scanned it — see
 * docs/reviews/2026-09-27-friend-full-rebuild-proposal.md's "QR Codes on
 * Every Washer & Dryer" and docs/DECISIONS.md for the design:
 *
 * - Signed-in staff (OWNER/ADMIN) → straight to that unit's own inventory
 *   detail page (status, current customer, full history, profitability).
 * - A signed-in customer currently renting this exact unit → their
 *   maintenance-request form, pre-selecting this appliance so they never
 *   have to know the model/serial number.
 * - Anyone else (not signed in, or a customer who doesn't currently have
 *   this unit) → asked to sign in, then sent back here — never shown any
 *   appliance detail before we know who they are.
 */
export default async function ScanApplianceRedirectPage({
  params,
}: {
  params: Promise<{ assetNumber: string }>;
}) {
  const { assetNumber } = await params;

  const appliance = await prisma.appliance.findUnique({
    where: { assetNumber },
    select: { id: true, applianceType: { select: { name: true } } },
  });

  if (!appliance) {
    notFound();
  }

  const session = await getServerSession();
  const nextUrl = `/scan/${encodeURIComponent(assetNumber)}`;

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
  }

  const role = (session.user as { role?: string }).role ?? "CUSTOMER";

  if (role === "OWNER" || role === "ADMIN" || role === "STAFF") {
    redirect(`/desk/inventory/${appliance.id}`);
  }

  const myActiveAppliances = await getActiveApplianceOptionsForUser(session.user.id);
  const isMine = myActiveAppliances.some((a) => a.id === appliance.id);

  if (isMine) {
    redirect(`/account/maintenance?applianceId=${appliance.id}`);
  }

  // A customer scanned a real appliance, but not one currently on their own
  // account — never show them anything about it (whose it is, its
  // history), just a safe, generic landing.
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12 text-center"
    >
      <h1 className="text-xl font-semibold text-ink">
        {appliance.applianceType.name}
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        This appliance isn&apos;t on your account. If you think that&apos;s
        wrong, or you need help with it, contact us directly.
      </p>
      <Link
        href="/contact"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-dark"
      >
        Contact us
      </Link>
    </main>
  );
}
