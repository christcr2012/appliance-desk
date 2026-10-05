import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { DraftNotice } from "@/components/site/draft-notice";
import { getBusinessSettings } from "@/domains/settings";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";

export const LEGAL_PAGE_VERSION = LEGAL_PAGE_VERSIONS.terms;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getBusinessSettings();
  const approved = isLegalPageApproved(
    (settings as { legalApprovals?: unknown }).legalApprovals,
    "terms",
    LEGAL_PAGE_VERSION,
  );
  return {
    title: "Terms of Use",
    description: "Terms for using this website and requesting an appliance rental quote.",
    robots: { index: approved, follow: approved },
  };
}

export default async function TermsPage() {
  const settings = await getBusinessSettings();
  const approved = isLegalPageApproved(
    (settings as { legalApprovals?: unknown }).legalApprovals,
    "terms",
    LEGAL_PAGE_VERSION,
  );

  return (
    <Container className="max-w-3xl py-16 md:py-20">
      <h1 className="font-display text-4xl font-semibold text-ink">
        Terms of Use
      </h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 2026-09-26</p>

      {!approved && (
        <div className="mt-6">
          <DraftNotice />
        </div>
      )}

      <div className="mt-10 space-y-8 text-ink-soft">
        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Scope
          </h2>
          <p className="mt-2">
            These terms cover your use of this website only. They are not
            your rental agreement — if you become a customer, the separate,
            signed Rental Agreement you enter with{" "}
            {settings.publicBusinessName} governs your actual rental (pricing,
            term, fees, deposit, and responsibilities).
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Requesting a quote is not a reservation
          </h2>
          <p className="mt-2">
            Submitting the quote form does not reserve an appliance, lock in
            a delivery date, or create a binding agreement. Nothing is final
            until you&apos;ve signed a Rental Agreement with us.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Accuracy of information
          </h2>
          <p className="mt-2">
            We try to keep pricing and availability information accurate and
            up to date, but errors can happen. If something on this site is
            wrong, the terms of your signed Rental Agreement control.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Acceptable use
          </h2>
          <p className="mt-2">
            Please use this site lawfully and don&apos;t attempt to disrupt
            it, submit false information, or misuse the quote form.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Governing law
          </h2>
          <p className="mt-2">
            These terms are governed by the laws of the State of Colorado.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Contact us
          </h2>
          <p className="mt-2">
            Questions? Reach us at{" "}
            <a
              href={`mailto:${settings.publicEmail}`}
              className="underline hover:text-primary"
            >
              {settings.publicEmail}
            </a>
            .
          </p>
        </section>
      </div>
    </Container>
  );
}
