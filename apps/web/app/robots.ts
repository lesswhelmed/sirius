import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Session-gated app + APIs aren't useful to crawlers. /catalog + /listing
      // are owner-gated while the public catalog is hidden (PUBLIC_CATALOG_ENABLED)
      // — drop them from disallow when public browsing returns.
      disallow: ["/api/", "/ingest", "/queue", "/settings", "/space", "/setup-handle", "/catalog", "/listing"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
