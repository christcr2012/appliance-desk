import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { DraftNotice } from "@/components/site/draft-notice";
import { getBusinessSettings } from "@/domains/settings";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";
import { PrivacyRequestForm } from "./privacy-request-form";

export const LEGAL_PAGE_VERSION = LEGAL_PAGE_VERSIONS.privacy;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getBusinessSettings();
  const approved = isLegalPageApproved(
    (settings as { legalApprovals?: unknown }).legalApprovals,
    "privacy",
    LEGAL_PAGE_VERSION,
  );
  return {
    title: "Privacy Policy",
    description: "How we collect, use, and protect your personal information.",
    robots: { index: approved, follow: approved },
  };
}

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; verified?: string }>;
}) {
  const settings = await getBusinessSettings();
  const params = await searchParams;
  const approved = isLegalPageApproved(
    (settings as { legalApprovals?: unknown }).legalApprovals,
    "privacy",
    LEGAL_PAGE_VERSION,
  );

  return (
    <Container className="max-w-3xl py-16 md:py-20">
      <h1 className="font-display text-4xl font-semibold text-ink">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 2026-09-29</p>

      {!approved && <div className="mt-6"><DraftNotice /></div>}

      {params.verified === "yes" && (
        <p role="status" className="mt-6 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">
          Your privacy request is verified. The owner can now process it.
        </p>
      )}
      {params.verified === "no" && (
        <p role="status" className="mt-6 rounded-lg border border-line bg-subtle p-3 text-sm text-ink">
          That verification link is invalid, expired, or already used. Contact us if you still need help with the request.
        </p>
      )}

      <div className="prose-content mt-10 space-y-8 text-ink-soft">
        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Who we are</h2>
          <p className="mt-2">
            {settings.publicBusinessName} (&quot;we,&quot; &quot;us&quot;) operates this website and provides appliance rental services in Colorado. This policy explains what personal information we collect, why, and the choices you have — written for U.S. residents, with attention to Colorado and California (CCPA/CPRA-style) privacy rights rather than the EU&apos;s GDPR, since we operate only in the U.S.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong>Launch interest list:</strong> your name, email, city, appliance interest, signup-source label, and a record of your email consent and subscription preferences.</li>
            <li><strong>Quote requests:</strong> your name, phone number, email (if given), service address, what you&apos;re interested in renting, and any notes you add.</li>
            <li><strong>Account &amp; rental information:</strong> if you become a customer, your rental agreement, billing, and service-history details.</li>
            <li><strong>Basic technical data:</strong> standard web server logs (e.g. IP address, browser type) generated automatically by visiting the site.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">How we use it</h2>
          <p className="mt-2">To follow up on quote requests, deliver and service rented appliances, bill accurately, comply with the law, and improve the site. We do not sell your personal information, and we do not share it with third parties for their own marketing.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Text messages</h2>
          <p className="mt-2">We only send text messages to numbers that have explicitly opted in, per the Telephone Consumer Protection Act (TCPA). You can opt out at any time by replying STOP, or by contacting us directly.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Launch emails</h2>
          <p className="mt-2">If you join our launch interest list, we use your information to send launch news and appliance-rental information. Our email provider processes your email address and message content to send these messages. Every launch email includes an unsubscribe link. Joining does not create a customer account, reserve an appliance, or opt you into text messages. We keep a minimal suppression record after you unsubscribe so a repeated signup does not restart your emails. You can contact us to request correction or deletion of your information.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Your rights</h2>
          <p className="mt-2">
            You can ask us to tell you what personal information we hold about you, correct it, or delete it, and you can opt out of any future communications. Signed-in customers can also request this directly from their account. To make a request, use the form below, contact us at{" "}
            <a href={`mailto:${settings.publicEmail}`} className="underline hover:text-primary">{settings.publicEmail}</a>{" "}
            or <a href={`tel:${settings.publicPhone.replace(/[^\d+]/g, "")}`} className="underline hover:text-primary">{settings.publicPhone}</a>. We will not discriminate against you for exercising these rights.
          </p>
        </section>

        <PrivacyRequestForm received={params.request === "received"} />

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">How long we keep it</h2>
          <p className="mt-2">We keep quote and rental records for as long as needed to run the business and meet our legal and tax obligations, then delete or anonymize them.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Security</h2>
          <p className="mt-2">We use reasonable technical and organizational measures to protect your information, including encrypted connections and access controls limiting who at our business can see it.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Children</h2>
          <p className="mt-2">Our services are intended for adults entering into a rental agreement. We do not knowingly collect personal information from children.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">Contact us</h2>
          <p className="mt-2">Questions about this policy? Reach us at <a href={`mailto:${settings.publicEmail}`} className="underline hover:text-primary">{settings.publicEmail}</a>.</p>
        </section>
      </div>
    </Container>
  );
}
