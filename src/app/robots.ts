import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Belt-and-suspenders alongside the X-Robots-Tag header in
      // next.config.ts and each page's own `robots` metadata.
      disallow: ["/desk", "/desk/", "/account", "/account/", "/sign", "/sign/"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
