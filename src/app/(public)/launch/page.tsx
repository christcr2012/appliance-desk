import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
import { getLaunchSettings } from "@/domains/launch";
import { Card } from "@/components/ui";
import { RichText } from "@/components/site/rich-text";
import { SiteCta } from "@/components/site/site-cta";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue, stripInlineLinks } from "@/domains/site-content/facts";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return {
    title: stripInlineLinks(content["seo.launch.title"] ?? ""),
    description: stripInlineLinks(content["seo.launch.description"] ?? ""),
    alternates: { canonical: "/launch" },
  };
}

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ utm_source?: string | string[]; revision?: string | string[] }>;
}) {
  const [settings, business, params] = await Promise.all([
    getLaunchSettings(),
    getBusinessSettings(),
    searchParams,
  ]);
  const site = await getSiteForRequest(params);
  const facts = siteFacts(business);
  const c = siteCopy(site.text, facts);
  const source =
    typeof params.utm_source === "string"
      ? params.utm_source.slice(0, 100)
      : "website";
  return (
    <>
      <SelectBridge site={site} />
    <PageHero eyebrow={c("launch.eyebrow")} heading={c("launch.heading")} lede={c("launch.intro")} />
    <Container className="grid gap-12 py-12 md:grid-cols-2 md:py-16">
      <div>
        <ul className="divide-y divide-hairline border-y border-hairline text-ink-soft [&>li]:py-4">
          {[1, 2, 3].map((n) => (
            <li key={n}>{c(`launch.point.${n}`)}</li>
          ))}
        </ul>
        <p className="mt-6 text-ink-soft">
          {settings.prelaunchMode ? c("launch.status.open") : c("launch.status.closed")}
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          <RichText text={c("launch.question")} />
        </p>
      </div>
      <Card title={settings.prelaunchMode ? c("launch.card.open") : c("launch.card.closed")}>
        {settings.prelaunchMode ? (
          <SignupForm source={source} copy={site.text} />
        ) : (
          <SiteCta
            value={siteLinkValue(site.values, "launch.card.cta")}
            profile={{ phone: business.publicPhone, email: business.publicEmail }}
            facts={facts}
          />
        )}
      </Card>
    </Container>
    </>
  );
}
