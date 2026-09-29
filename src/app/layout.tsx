import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import Script from "next/script";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getBusinessSettings } from "@/domains/settings";
import "./globals.css";

// Brand kit v2.0 ("Evergreen," 2026-09-29 — see docs/DECISIONS.md) uses
// one typeface everywhere — Manrope, at heading/label/body weights —
// replacing the prior Inter (body) + Fraunces (headings) pairing.
// Loaded once here as a single variable font and mapped to both
// --font-display and --font-sans in globals.css, so every existing
// class that already asked for either one keeps working without a
// find/replace across every component.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// The browser tab title/description come from here, the one shared root
// layout every page renders through — this must read the real business
// name live from BusinessSettings, the same way the homepage's own body
// text already does (src/app/(public)/page.tsx), or editing the name in
// /desk/settings silently stops working for the tab title/search-engine
// listing even though the page's visible content updates correctly. This
// was a real bug: the tab title stayed on the "[Company Name]" placeholder
// after Chris entered the real business name, because this used to be a
// static `export const metadata` object rather than a dynamic function.
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getBusinessSettings();
  const businessName = settings.publicBusinessName;
  const description =
    "Rent a washer and dryer in Colorado with simple month-to-month pricing, fast delivery, and no long-term commitment.";

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${businessName} — Appliance Rentals in Colorado`,
      template: `%s — ${businessName}`,
    },
    description,
    // A dedicated, purpose-made social-share image from brand kit v2.0
    // (2026-09-29, see docs/DECISIONS.md) — sized and cropped for how
    // link previews actually render, replacing the earlier stopgap of
    // reusing the homepage's hero photo (flagged in docs/ROADMAP.md as
    // a "worth revisiting once a dedicated image exists" item; it now
    // does).
    openGraph: {
      title: `${businessName} — Appliance Rentals in Colorado`,
      description,
      url: siteUrl,
      siteName: businessName,
      images: [{ url: "/brand/social-share.png", width: 1200, height: 630 }],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${businessName} — Appliance Rentals in Colorado`,
      description,
      images: ["/brand/social-share.png"],
    },
    manifest: "/manifest.webmanifest",
  };
}

// Brand kit v2.0's evergreen (matches the manifest's own theme_color) —
// tints the browser UI (mobile Chrome's address bar, a PWA install
// splash screen) to match the brand instead of staying browser-default.
export const viewport: Viewport = {
  themeColor: "#123C2D",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        {/* Sets the .dark class (Chris's dark mode, 2026-09-27) before
            the page paints, so there's no flash of the wrong theme
            while the rest of the app loads. beforeInteractive runs this
            as early as Next.js allows — see src/lib/theme.ts. Served
            from a real static file (public/theme-init.js) rather than
            inlined, so the Content-Security-Policy header (2026-09-29)
            can lock script-src down to 'self' with no exceptions — see
            that file's own comment for why. */}
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
        {/* Real-world page-speed monitoring (2026-09-28, Chris's ask
            from the Vercel dashboard's "Speed Insights" setup card) —
            free on Vercel's Pro plan, no cost/account action needed.
            Only reports anything once this is deployed and visited. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
