import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { DraftNotice } from "@/components/site/draft-notice";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "How we handle your information",
  description: "How long we keep information about you, and how we destroy it when we no longer need it.",
};
// The years come from the owner's settings, so the page must not be built once and frozen.
export const dynamic = "force-dynamic";

export default async function HowWeHandlePage() {
  const s = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { retentionAgreementYears: true, retentionTaxYears: true, retentionLeadYears: true, retentionMessageYears: true, retentionRefrigerantYears: true },
  });
  const years = {
    agreement: s?.retentionAgreementYears ?? 7, tax: s?.retentionTaxYears ?? 7, lead: s?.retentionLeadYears ?? 2,
    message: s?.retentionMessageYears ?? 3, refrigerant: s?.retentionRefrigerantYears ?? 6,
  };
  const plural = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
  return (
    <Container className="max-w-3xl py-16 md:py-20">
      <h1 className="font-display text-4xl font-semibold text-ink">How we handle your information</h1>
      <div className="mt-6"><DraftNotice /></div>
      <div className="mt-8 space-y-6 text-ink">
        <section>
          <h2 className="font-display text-2xl font-semibold">What we keep, and for how long</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Rental agreements, bills and payment records: {plural(years.agreement)} after your account closes, because the law and our accountant need them.</li>
            <li>Tax and mileage records: {plural(years.tax)}.</li>
            <li>Refrigerant service records: {plural(years.refrigerant)}.</li>
            <li>Messages between you and us: {plural(years.message)}.</li>
            <li>Questions from people who never became customers: {plural(years.lead)}, then they are removed.</li>
          </ul>
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold">How we destroy information</h2>
          <p className="mt-3">When information is no longer needed, we delete it from our system and from our service providers. Paper copies are shredded. We do not keep information longer than the periods above unless a law, a dispute or a legal request requires it.</p>
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold">Who else handles it</h2>
          <p className="mt-3">We use companies that host our website, store our records, take payments, and send texts and email. We ask each one to protect your information, and we re-check their security terms every year.</p>
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold">Your choices</h2>
          <p className="mt-3">You can ask to see or delete your information on our <Link className="underline" href="/privacy">privacy page</Link>. We do not use face-scan identification.</p>
        </section>
      </div>
    </Container>
  );
}
