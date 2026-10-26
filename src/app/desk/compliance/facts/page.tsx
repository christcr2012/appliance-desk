import Link from "next/link";
import { requireRole } from "@/lib/session";
import { hasFieldCryptoKey } from "@/lib/field-crypto";
import { getComplianceProfile } from "@/domains/compliance/profile";
import { FactsForm } from "./facts-form";

export const metadata = { title: "Business facts", robots: { index: false, follow: false } };

export default async function BusinessFactsPage() {
  await requireRole("OWNER");
  const profile = await getComplianceProfile();
  return (
    <div className="space-y-5">
      <p>
        <Link href="/desk/compliance" className="text-sm underline">
          ← All compliance
        </Link>
      </p>
      <h2 className="text-xl font-bold text-ink">Business facts</h2>
      <p className="max-w-xl text-sm text-ink-soft">
        A few facts about the business decide which filings apply and when they&apos;re due. Only you can
        change these.
      </p>
      <FactsForm
        entityType={profile.entityType}
        einLast4={profile.einLast4}
        einKeyReady={hasFieldCryptoKey()}
        sosReportMonth={profile.sosReportMonth}
        truckGvwrLbs={profile.truckGvwrLbs}
        employees={profile.employees}
        hasHomeOffice={profile.hasHomeOffice}
      />
    </div>
  );
}
