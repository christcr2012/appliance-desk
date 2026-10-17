import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { getPublishedCatalog } from "@/domains/pricing";
import { getBusinessSettings } from "@/domains/settings";
import { BusinessHours } from "@/components/site/business-hours";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts } from "@/domains/site-content/facts";
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
  const [catalog, site, settings] = await Promise.all([
    getPublishedCatalog(),
    searchParams.then(getSiteForRequest),
    getBusinessSettings(),
  ]);
  const content = site.text;
  const c = siteCopy(content, siteFacts(settings));

  return (
    <>
      <SelectBridge site={site} />
    <section className="py-16 md:py-20">
      <Container className="max-w-2xl">
        <h1 className="font-display text-4xl font-semibold text-ink">
          {c("contact.heading")}
        </h1>
        <p className="mt-4 text-ink-soft">
          {c("contact.intro")}
        </p>

        <div className="mt-6">
          <Card>
            <BusinessHours
              hours={settings.hours}
              holidayClosures={settings.holidayClosures}
              headingLevel="h2"
              hoursHeading={c("footer.hours.heading")}
              closuresHeading={c("footer.closures.heading")}
            />
          </Card>
        </div>

        <div className="mt-10">
          <ContactForm
            copy={content}
            applianceTypes={catalog
              .filter((item) => item.kind === "type")
              .map((t) => ({ id: t.id, name: t.name }))}
            packages={catalog
              .filter((item) => item.kind === "package")
              .map((p) => ({ id: p.id, name: p.name, contents: p.contents ?? "" }))}
          />
        </div>
      </Container>
    </section>
    </>
  );
}
