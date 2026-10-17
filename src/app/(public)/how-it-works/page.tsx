import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
import { SiteCta } from "@/components/site/site-cta";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.how-it-works.title"], description: content["seo.how-it-works.description"] };
}

export default async function HowItWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [site, settings] = await Promise.all([getSiteForRequest(await searchParams), getBusinessSettings()]);
  const content = site.text;
  const c = siteCopy(content, siteFacts(settings));
  const STEPS = [1, 2, 3, 4, 5].map((n) => ({
    title: c(`how.${n}.title`),
    body: c(`how.${n}.body`),
  }));
  return (
    <>
      <SelectBridge site={site} />
      <PageHero heading={c("how.heading")} lede={c("how.intro")} />

      <Container className="py-16 md:py-20">
        <ol className="mx-auto max-w-3xl divide-y divide-hairline border-y border-hairline [counter-reset:step]">
          {STEPS.map((step) => (
            <li key={step.title} className="grid grid-cols-[3rem_1fr] gap-5 py-8 md:grid-cols-[4rem_1fr] md:gap-8">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display text-lg font-extrabold text-on-primary [counter-increment:step] before:content-[counter(step)] md:h-14 md:w-14"
              />
              <div>
                <h2 className="text-h3 text-ink">{step.title}</h2>
                <p className="mt-2 text-lede text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-12 text-center">
          <SiteCta
            value={siteLinkValue(site.values, "how.cta")}
            profile={{ phone: settings.publicPhone, email: settings.publicEmail }}
            facts={siteFacts(settings)}
          />
        </div>
      </Container>
    </>
  );
}
