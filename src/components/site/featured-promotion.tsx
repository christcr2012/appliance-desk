import Image from "next/image";
import { Card } from "@/components/ui";
import { Container } from "./container";
import { SiteCta } from "./site-cta";
import { draftAssetPath, publicAssetPath } from "@/domains/site-content/asset-paths";
import { fillSiteText, type SiteTextFacts } from "@/domains/site-content/fields";
import { livePromotion } from "@/domains/site-content/promotions";
import type { SiteValue } from "@/domains/site-content/types";

/** The highlighted offer on the home page. Nothing at all unless the owner switched it on and its Colorado-time window is open. */
export function FeaturedPromotion({
  value,
  now,
  preview,
  profile,
  facts,
}: {
  value: SiteValue | undefined;
  now: Date;
  preview: boolean;
  profile: { phone: string | null; email: string | null };
  facts: SiteTextFacts;
}) {
  const promo = livePromotion(value?.kind === "promotion" ? value : undefined, now);
  if (!promo) return null;
  const image = promo.image;
  return (
    <section aria-label="Featured offer">
      <Container className="py-8">
        <Card title={fillSiteText(promo.title, facts)}>
          <div className="flex flex-col gap-5 md:flex-row md:items-center">
            {image ? (
              <Image
                src={preview ? draftAssetPath(image.assetId) : publicAssetPath(image.assetId)}
                alt={image.decorative ? "" : image.alt}
                width={480}
                height={320}
                unoptimized
                className="h-40 w-full rounded-control object-cover md:w-64"
                style={{ objectPosition: `${image.focalX}% ${image.focalY}%` }}
              />
            ) : null}
            <div className="flex-1">
              {promo.body ? <p className="text-ink-soft">{fillSiteText(promo.body, facts)}</p> : null}
              {promo.cta ? (
                <div className="mt-4">
                  <SiteCta value={promo.cta} profile={profile} facts={facts} />
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      </Container>
    </section>
  );
}
