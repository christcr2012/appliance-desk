import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import Script from "next/script";
import { getBusinessSettings } from "@/domains/settings";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Font pairing for the "modern but warm/personal" brief: Fraunces is a
// soft, humanist serif with real character for headings (not a cold
// corporate sans everywhere), paired with Inter — a highly legible,
// battle-tested UI sans — for body text and forms. Both are variable
// fonts loaded as CSS variables and mapped to --font-display/--font-sans
// in globals.css.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
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

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: `${businessName} — Appliance Rentals in Colorado`,
      template: `%s — ${businessName}`,
    },
    description:
      "Rent a washer and dryer in Colorado with simple month-to-month pricing, fast delivery, and no long-term commitment.",
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        {/* Sets the .dark class (Chris's dark mode, 2026-09-27) before
            the page paints, so there's no flash of the wrong theme
            while the rest of the app loads. beforeInteractive runs this
            as early as Next.js allows — see src/lib/theme.ts. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
