import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Static marketing/public routes. Owner spaces and individual posts are
// intentionally excluded — they're per-user and not part of the marketing index.
// /catalog is omitted while the public catalog is hidden (PUBLIC_CATALOG_ENABLED);
// add it back here when public browsing returns.
export default function sitemap(): MetadataRoute.Sitemap {
	const routes: Array<{
		path: string;
		priority: number;
		changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
	}> = [
		{ path: "/product", priority: 1.0, changeFrequency: "monthly" },
		{ path: "/support", priority: 0.3, changeFrequency: "yearly" },
		{ path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
	];
	return routes.map(({ path, priority, changeFrequency }) => ({
		url: `${SITE_URL}${path}`,
		priority,
		changeFrequency,
	}));
}
