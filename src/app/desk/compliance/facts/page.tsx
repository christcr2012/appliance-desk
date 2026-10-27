import Link from "next/link";
import { requireRole } from "@/lib/session";
import { hasFieldCryptoKey } from "@/lib/field-crypto";
import { getComplianceProfile } from "@/domains/compliance/profile";
import { businessDateKey } from "@/lib/business-date";
import { getTaxYearFacts } from "@/domains/compliance/tax-facts";
import { formatMoney } from "@/lib/money-ui";
import { FactsForm } from "./facts-form";
import { TaxYearFactsForm } from "./tax-year-facts-form";

export const metadata = { title: "Business facts", robots: { index: false, follow: false } };

// An editable dollar string for the form inputs, from the shared money format.
const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : formatMoney(cents).replace(/[$,]/g, "");

export default async function BusinessFactsPage({
  searchParams,
}: {
  searchParams: Promise<{ taxYear?: string }>;
}) {
  await requireRole("OWNER");
  const profile = await getComplianceProfile();
  const { taxYear } = await searchParams;
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const year = years.includes(Number(taxYear)) ? Number(taxYear) : thisYear - 1;
  const facts = await getTaxYearFacts(year);
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
        firstHireDate={profile.firstHireDate ? businessDateKey(profile.firstHireDate) : ""}
        hasHomeOffice={profile.hasHomeOffice}
        payer={{
          businessLegalName: profile.businessLegalName ?? "",
          businessAddress: profile.businessAddress ?? "",
          businessCity: profile.businessCity ?? "",
          businessState: profile.businessState ?? "",
          businessZip: profile.businessZip ?? "",
          businessPhone: profile.businessPhone ?? "",
        }}
        local={{
          tradeName: profile.tradeName ?? "",
          usdotNumber: profile.usdotNumber ?? "",
          truckRegistrationMonth: profile.truckRegistrationMonth,
          greeleyLicenseDate: profile.greeleyLicenseDate ? businessDateKey(profile.greeleyLicenseDate) : "",
          registeredAgentName: profile.registeredAgentName ?? "",
          registeredAgentAddress: profile.registeredAgentAddress ?? "",
          registeredAgentCity: profile.registeredAgentCity ?? "",
          registeredAgentState: profile.registeredAgentState ?? "",
          registeredAgentZip: profile.registeredAgentZip ?? "",
        }}
      />
      <TaxYearFactsForm
        key={year}
        year={year}
        years={years}
        facts={{
          federalTax: dollars(facts?.federalTaxCents),
          federalAgi: dollars(facts?.federalAgiCents),
          coloradoTax: dollars(facts?.coloradoTaxCents),
          form1099KGross: dollars(facts?.form1099KGrossCents),
        }}
      />
    </div>
  );
}
