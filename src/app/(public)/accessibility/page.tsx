import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { getBusinessSettings } from "@/domains/settings";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description: "Our commitment to an accessible website, and how to report a problem.",
  robots: { index: true, follow: true },
};

export default async function AccessibilityPage() {
  const settings = await getBusinessSettings();

  return (
    <Container className="max-w-3xl py-16 md:py-20">
      <h1 className="font-display text-4xl font-semibold text-ink">
        Accessibility Statement
      </h1>
      <p className="mt-2 text-sm text-ink-faint">Last updated: 2026-09-26</p>

      <div className="mt-10 space-y-8 text-ink-soft">
        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Our commitment
          </h2>
          <p className="mt-2">
            {settings.publicBusinessName} wants this website to be usable by
            everyone, including people who use screen readers, keyboard-only
            navigation, voice control, or browser zoom. We build to the Web
            Content Accessibility Guidelines (WCAG) 2.1 level AA, and every
            page is checked automatically for common issues (missing labels,
            poor color contrast, keyboard traps) before it goes live.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            What we&apos;ve done
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Full keyboard navigation with a visible focus indicator.</li>
            <li>Labeled form fields, with errors announced to screen readers.</li>
            <li>Sufficient color contrast, and no information conveyed by color alone.</li>
            <li>Respect for your operating system&apos;s reduced-motion setting.</li>
            <li>A layout that works at 200% browser zoom and on phones.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Known limitations
          </h2>
          <p className="mt-2">
            Automated checks catch a lot, but not everything — a full manual
            screen-reader and keyboard review is planned before this site is
            considered fully launched. If you find something that doesn&apos;t
            work well for you, please tell us — see below.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold text-ink">
            Report a problem
          </h2>
          <p className="mt-2">
            If any part of this site is difficult to use with assistive
            technology, contact us and we&apos;ll work to fix it and help you
            directly in the meantime:
          </p>
          <p className="mt-2">
            <a
              href={`mailto:${settings.publicEmail}`}
              className="underline hover:text-primary"
            >
              {settings.publicEmail}
            </a>{" "}
            &middot;{" "}
            <a
              href={`tel:${settings.publicPhone.replace(/[^\d+]/g, "")}`}
              className="underline hover:text-primary"
            >
              {settings.publicPhone}
            </a>
          </p>
        </section>
      </div>
    </Container>
  );
}
