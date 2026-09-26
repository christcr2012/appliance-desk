import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/site/button-link";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How washer and dryer rentals work, from your first request to delivery and ongoing service.",
};

const STEPS = [
  {
    title: "1. Tell us what you need",
    body: "Fill out the quote form with what you're looking to rent, your address, and your preferred term. It takes about two minutes.",
  },
  {
    title: "2. We follow up personally",
    body: "Chris reviews every request himself and calls or texts you back — usually the same day — to confirm details and answer questions.",
  },
  {
    title: "3. Sign your rental agreement",
    body: "Once everything's confirmed, you'll sign a straightforward rental agreement electronically. Your price is locked in from that point on.",
  },
  {
    title: "4. Delivery & installation",
    body: "We schedule a delivery window that works for you, bring the appliance, install it, and haul away your old one if you need that.",
  },
  {
    title: "5. Ongoing service",
    body: "If anything ever needs attention, you contact us directly — not a national warranty line. We track every request until it's resolved.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            How it works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            No app to download, no self-checkout — a real person reviews and
            handles every step.
          </p>
        </Container>
      </section>

      <Container className="py-16 md:py-20">
        <ol className="mx-auto max-w-2xl space-y-10">
          {STEPS.map((step) => (
            <li key={step.title} className="border-l-4 border-primary pl-6">
              <h2 className="font-display text-xl font-semibold text-ink">
                {step.title}
              </h2>
              <p className="mt-2 text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-16 text-center">
          <ButtonLink href="/contact" variant="primary">
            Get a free quote
          </ButtonLink>
        </div>
      </Container>
    </>
  );
}
