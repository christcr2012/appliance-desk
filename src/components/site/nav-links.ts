// Single source of truth for the public site's primary navigation, used by
// both the desktop nav and the mobile menu so they never drift apart.
// Destinations are fixed in code (required navigation cannot be removed or pointed elsewhere); the words are website
// content (V-C3), looked up by `labelKey`.
export const NAV_LINKS = [
  { href: "/pricing", labelKey: "nav.pricing" },
  { href: "/how-it-works", labelKey: "nav.howItWorks" },
  { href: "/service-area", labelKey: "nav.serviceArea" },
  { href: "/contact", labelKey: "nav.contact" },
] as const;

export function publicNavLinks(prelaunch: boolean, text: Record<string, string>) {
  return NAV_LINKS.filter((link) => !prelaunch || link.href !== "/pricing").map((link) => ({
    href: link.href,
    label: text[link.labelKey] ?? "",
  }));
}
