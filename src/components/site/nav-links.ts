// Single source of truth for the public site's primary navigation, used by
// both the desktop nav and the mobile menu so they never drift apart.
export const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/service-area", label: "Service Area" },
  { href: "/contact", label: "Get a Quote" },
] as const;
