import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Session-gated app + APIs aren't useful to crawlers.
      disallow: ["/api/", "/ingest", "/queue", "/settings", "/space", "/setup-handle"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
