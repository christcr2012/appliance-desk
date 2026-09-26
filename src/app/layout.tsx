import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "[Company Name] — Appliance Rentals in Colorado",
    template: "%s — [Company Name]",
  },
  description:
    "Rent a washer and dryer in Colorado with simple month-to-month pricing, fast delivery, and no long-term commitment.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
