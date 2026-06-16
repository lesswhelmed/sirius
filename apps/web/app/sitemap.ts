import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Static marketing/public routes. Owner spaces and individual posts are
// intentionally excluded — they're per-user and not part of the marketing index.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
    { path: "/product", priority: 1.0, changeFrequency: "monthly" },
    { path: "/catalog", priority: 0.8, changeFrequency: "daily" },
    { path: "/support", priority: 0.3, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  ];
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    priority,
    changeFrequency,
  }));
}
