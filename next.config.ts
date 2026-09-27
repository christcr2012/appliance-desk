import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
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
