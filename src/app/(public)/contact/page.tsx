import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { getPublishedApplianceTypes } from "@/domains/pricing";
import { getBusinessSettings } from "@/domains/settings";
import { BusinessHours } from "@/components/site/business-hours";
import { getPublishedContent } from "@/domains/site-content";
import { getContentForRequest } from "@/domains/site-content/request";
import { Card } from "@/components/ui";
import { ContactForm } from "./contact-form";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.contact.title"], description: content["seo.contact.description"] };
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [applianceTypes, content, settings] = await Promise.all([
    getPublishedApplianceTypes(),
    searchParams.then(getContentForRequest),
    getBusinessSettings(),
  ]);

  return (
    <section className="py-16 md:py-20">
      <Container className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold text-ink">
          Get a free quote
        </h1>
        <p className="mt-4 text-ink-soft">
          {content["contact.intro"]}
        </p>

        <div className="mt-6">
          <Card>
            <BusinessHours
              hours={settings.hours}
              holidayClosures={settings.holidayClosures}
              headingLevel="h2"
            />
          </Card>
        </div>

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
