import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { getPublishedApplianceTypes } from "@/domains/pricing";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Get a Quote",
  description:
    "Request a washer or dryer rental quote in Colorado — we follow up personally, usually the same day.",
};

export default async function ContactPage() {
  const applianceTypes = await getPublishedApplianceTypes();

  return (
    <section className="py-16 md:py-20">
      <Container className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold text-ink">
          Get a free quote
        </h1>
        <p className="mt-4 text-ink-soft">
          Tell us a bit about what you need. There&apos;s no obligation, and
          we never charge anything until you&apos;ve signed a rental
          agreement.
        </p>

        <div className="mt-10">
          <ContactForm
            applianceTypes={applianceTypes.map((t) => ({
              id: t.id,
              name: t.name,
              monthlyPriceCents: t.monthlyPriceCents,
            }))}
          />
        </div>
      </Container>
    </section>
  );
}
