import Link from "next/link";
import { ButtonLink, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { fillSiteText, type SiteTextFacts } from "@/domains/site-content/fields";
import { linkRel, resolveLinkHref } from "@/domains/site-content/links";
import type { LinkValue } from "@/domains/site-content/types";

/**
 * A button or link whose words and destination the owner chose. A phone or email destination uses the business
 * profile's own number or address (and shows nothing if the profile has none); other websites get safe `rel`.
 */
export function SiteCta({
  value,
  profile,
  facts = {},
  variant = "primary",
  size,
  className = "",
  textStyle = false,
}: {
  value: LinkValue | undefined;
  profile: { phone: string | null; email: string | null };
  facts?: SiteTextFacts;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Show as a plain underlined text link instead of a button. */
  textStyle?: boolean;
}) {
  if (!value) return null;
  const href = resolveLinkHref(value.target, profile);
  if (!href) return null;
  const label = fillSiteText(value.label, facts);
  const rel = linkRel(value.target);
  if (textStyle) {
    return (
      <Link href={href} rel={rel} className={className || "inline-flex min-h-11 items-center font-semibold text-primary underline"}>
        {label}
      </Link>
    );
  }
  return (
    <ButtonLink href={href} rel={rel} variant={variant} size={size} className={className}>
      {label}
    </ButtonLink>
  );
}
