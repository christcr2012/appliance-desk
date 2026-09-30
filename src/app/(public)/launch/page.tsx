import Link from "next/link";
import { Container } from "@/components/site/container";
import { getLaunchSettings } from "@/domains/launch";
import { SignupForm } from "./signup-form";

export const metadata = {
  title: "Greeley appliance rentals — launch interest list",
  description:
    "A family-owned washer and dryer rental business preparing to serve Greeley and surrounding areas. Join for launch news. Maintenance included.",
  alternates: { canonical: "/launch" },
};

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ utm_source?: string | string[] }>;
}) {
  const [settings, params] = await Promise.all([
    getLaunchSettings(),
    searchParams,
  ]);
  const source =
    typeof params.utm_source === "string"
      ? params.utm_source.slice(0, 100)
      : "website";
  return (
    <Container className="grid gap-12 py-16 md:grid-cols-2 md:py-20">
      <div>
        <p className="font-semibold text-primary">
          Greeley, Colorado + surrounding areas
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold text-ink">
          Make room for everyday.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          We&apos;re Robinson Appliance Rentals, a small family business
          building a local option for washer and dryer rentals.
        </p>
        <ul className="mt-6 list-disc space-y-3 pl-5 text-ink-soft">
          <li>Maintenance is always included.</li>
          <li>
            Delivery and installation are available. Requirements and any fees
            depend on your situation.
          </li>
          <li>For local households, landlords, and property managers.</li>
        </ul>
        <p className="mt-6 text-ink-soft">
          {settings.prelaunchMode
            ? "We're still preparing to open. Join for launch news and a short introduction to how we plan to help. Our opening date is not yet confirmed."
            : "Our prelaunch list is closed. Contact us to discuss your rental needs."}
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          Already have a specific question?{" "}
          <Link href="/contact" className="underline">
            Contact us
          </Link>
          .
        </p>
      </div>
      <section
        aria-labelledby="signup-title"
        className="rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        <h2
          id="signup-title"
          className="mb-6 font-display text-2xl font-semibold"
        >
          {settings.prelaunchMode
            ? "Be part of our local launch"
            : "Let's talk about your needs"}
        </h2>
        {settings.prelaunchMode ? (
          <SignupForm source={source} />
        ) : (
          <Link href="/contact" className="underline">
            Request information
          </Link>
        )}
      </section>
    </Container>
  );
}
