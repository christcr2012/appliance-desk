import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Content-Security-Policy (added 2026-09-29, part of a proactive
// scaling/hardening pass — see docs/DECISIONS.md). This is the header
// that blocks an injected/malicious script from running even if
// something elsewhere were ever compromised (e.g. a stored-XSS bug in a
// form field that isn't properly escaped somewhere down the line).
//
// Deliberately the *static* next.config.ts approach, not Next's
// nonce-based approach (see node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md) — a nonce requires EVERY page to switch to
// dynamic (per-request) rendering, which trades away static
// generation/CDN caching and would work against the Speed Insights
// performance work done in this same pass, for a small business site
// that isn't handling anything nonces meaningfully protect beyond what
// a locked-down script-src already does.
//
// Every origin below was confirmed as actually used by reading the
// code, not guessed:
//   - script-src: 'self' (every script this app serves, including the
//     old inline dark-mode anti-flash script, which moved to a real
//     file at public/theme-init.js on this same date specifically so
//     script-src could be 'self' with no 'unsafe-inline' exception —
//     see that file's own comment) + Vercel's own Speed Insights
//     loader script (va.vercel-scripts.com).
//   - style-src needs 'unsafe-inline': two places compute a truly
//     dynamic inline style per render (a data-driven bar-chart height
//     in /desk/revenue, and nothing else after the same pass removed
//     every other inline `style` that was actually a static value —
//     see the same-date commit). Style-based injection is a much lower
//     real risk than script injection, so this is a deliberate,
//     narrow trade-off, not an oversight.
//   - img-src: 'self' only. Every uploaded photo (delivery/condition/
//     appliance/maintenance photos, all uploaded via
//     src/app/api/uploads/photo to this app's own Vercel Blob store) is
//     now rendered through next/image (2026-09-29, part of the same
//     mobile-performance pass that added images.remotePatterns below),
//     which fetches the remote file itself and serves it from this
//     app's own /_next/image endpoint — so the browser's img-src check
//     never sees the Blob storage domain at all, and it doesn't need an
//     entry here. (It used to: every photo was a plain <img
//     src="https://*.public.blob.vercel-storage.com/...">, which is also
//     why they were shipped to every visitor unresized and at full
//     upload quality — see docs/DECISIONS.md for the fuller story.) No
//     blob:/data: either — nothing in this app creates an in-browser
//     object URL or a data-URI image; grepped to confirm before removing
//     it, not assumed.
//   - connect-src: 'self' (this app's own API routes/server actions)
//     + Sentry's ingest domain (error monitoring reports from the
//     browser — instrumentation-client.ts).
//   - Stripe needs NO entry anywhere in this policy: this app only
//     ever does a full-page `window.location.href` redirect to
//     Stripe's own hosted Checkout/Billing Portal pages
//     (src/app/sign/[id]/sign-form.tsx and the billing-portal action) —
//     never loads Stripe.js or embeds a Stripe iframe on this site, so
//     there's nothing to allow-list for it.
const isDev = process.env.NODE_ENV === "development";
const cspHeader = `
  default-src 'self';
  script-src 'self' https://va.vercel-scripts.com${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self';
  font-src 'self';
  connect-src 'self' https://*.sentry.io;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  // Lets next/image optimize the photos Chris and customers upload
  // (appliance photos, job/condition photos, maintenance photos) —
  // added 2026-09-29 as part of the mobile performance investigation
  // (docs/DECISIONS.md). Every upload goes through
  // src/components/photo-upload-field.tsx, which always lands in this
  // app's own Vercel Blob store, so this is the one real external host
  // photos ever come from — not a general-purpose allow-list. Without
  // this, next/image refuses to render a photo from any host it doesn't
  // recognize, which is why these were plain <img> tags before (see
  // docs/DECISIONS.md for the full story — full-resolution phone photos
  // served unresized/unconverted to every visitor, on every device,
  // eagerly, is the single biggest reason mobile pages were slow).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  async headers() {
    return [
      {
        // Baseline security headers on every response. See docs/DECISIONS.md.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: cspHeader },
          // Forces the browser to always use HTTPS for this domain (never a
          // plain-HTTP downgrade), for a full year, including subdomains.
          // Safe to add now that a real custom domain with SSL is live —
          // see docs/DECISIONS.md.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Keep the admin desk, customer portal, and per-customer signing
        // links out of search engines.
        source: "/(desk|account|sign)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // Source-map upload to Sentry only runs when these are set (in CI/Vercel);
  // a local build without them just skips it, it doesn't fail.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
