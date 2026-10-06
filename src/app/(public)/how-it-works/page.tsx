import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/ui";
import { getPublishedContent } from "@/domains/site-content";
import { getContentForRequest } from "@/domains/site-content/request";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.how-it-works.title"], description: content["seo.how-it-works.description"] };
}

export default async function HowItWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const content = await getContentForRequest(await searchParams);
  const STEPS = [1, 2, 3, 4, 5].map((n) => ({
    title: content[`how.${n}.title`],
    body: content[`how.${n}.body`],
  }));
  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            How it works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            {content["how.intro"]}
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
