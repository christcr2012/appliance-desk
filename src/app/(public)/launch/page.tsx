import type { Metadata } from "next";
import { Container } from "@/components/site/container";
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
    <Container className="grid gap-12 py-16 md:grid-cols-2 md:py-20">
      <div>
        <p className="font-semibold text-primary">
          {c("launch.eyebrow")}
        </p>
        <h1 className="mt-4 font-display text-4xl font-semibold text-ink">
          {c("launch.heading")}
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          {c("launch.intro")}
        </p>
        <ul className="mt-6 list-disc space-y-3 pl-5 text-ink-soft">
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
  );
}
