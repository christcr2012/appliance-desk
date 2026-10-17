import Image from "next/image";
import { draftAssetPath, publicAssetPath } from "@/domains/site-content/asset-paths";
import type { SiteValue } from "@/domains/site-content/types";

/**
 * The big home-page photo. Shows the owner's chosen website picture when there is one, otherwise the standard photo.
 * A picture is cropped around the point the owner chose; its description comes from what they wrote (or empty when
 * they marked it decorative).
 */
export function HeroPicture({
  value,
  defaultAlt,
  preview,
}: {
  value: SiteValue | undefined;
  defaultAlt: string;
  /** A signed-in owner's preview of a draft: uses the draft picture route, which visitors cannot reach. */
  preview: boolean;
}) {
  const className = "h-auto w-full rounded-control object-cover";
  if (value?.kind === "image") {
    return (
      <Image
        src={preview ? draftAssetPath(value.assetId) : publicAssetPath(value.assetId)}
        alt={value.decorative ? "" : value.alt}
        width={1408}
        height={768}
        unoptimized
        className={`${className} aspect-[1408/768]`}
        style={{ objectPosition: `${value.focalX}% ${value.focalY}%` }}
        priority
      />
    );
  }
  return <Image src="/appliances/hero-lineup.jpg" alt={defaultAlt} width={1408} height={768} className={className} priority />;
}
