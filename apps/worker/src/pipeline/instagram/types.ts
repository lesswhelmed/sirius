// Normalized evidence object built from one Apify dataset item. Mirrors only
// fields we care about downstream; the full raw item is preserved on `raw`
// so future digest passes can reach back without re-scraping.

export type InstagramOwner = {
	username: string | null;
	fullName: string | null;
	isVerified: boolean | null;
	followerCount: number | null;
	profilePicUrl: string | null;
};

export type InstagramLocation = {
	id: string | null;
	name: string | null;
	lat: number | null;
	lng: number | null;
};

export type InstagramMediaAsset = {
	type: "image" | "video" | "unknown";
	url: string | null;
	width: number | null;
	height: number | null;
	duration: number | null;
};

export type InstagramEvidence = {
	// Source
	shortcode: string | null;
	id: string | null;
	url: string;
	postType: "post" | "reel" | "tv" | "carousel" | "unknown";
	createdAt: string | null;

	// Engagement
	likeCount: number | null;
	commentCount: number | null;
	playCount: number | null;
	viewCount: number | null;

	// Text
	caption: string | null;
	hashtags: string[];
	mentions: string[];

	// Media
	primaryImageUrl: string | null;
	primaryVideoUrl: string | null;
	assets: InstagramMediaAsset[];

	// Context
	owner: InstagramOwner;
	location: InstagramLocation | null;

	// Provenance
	raw: Record<string, unknown>;
};

function asString(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v)) {
		return v;
	}
	if (typeof v === "string" && v.length > 0) {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function asBool(v: unknown): boolean | null {
	if (typeof v === "boolean") {
		return v;
	}
	return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function asArray(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}

function extractHashtags(caption: string | null): string[] {
	if (!caption) return [];
	const tags = caption.match(/#[A-Za-z0-9_]+/g) ?? [];
	return Array.from(new Set(tags.map((t) => t.slice(1).toLowerCase())));
}

function extractMentions(caption: string | null): string[] {
	if (!caption) return [];
	const mentions = caption.match(/@[A-Za-z0-9._]+/g) ?? [];
	return Array.from(new Set(mentions.map((m) => m.slice(1).toLowerCase())));
}

function detectPostType(
	raw: Record<string, unknown>,
): InstagramEvidence["postType"] {
	const t = asString(raw.type) ?? asString(raw.productType);
	if (!t) {
		if (asBool(raw.isVideo)) return "reel";
		if (asBool(raw.isCarousel) || asArray(raw.carouselMedia).length > 0) {
			return "carousel";
		}
		return "post";
	}
	const lower = t.toLowerCase();
	if (lower.includes("reel") || lower.includes("clip")) return "reel";
	if (lower.includes("carousel") || lower.includes("sidecar"))
		return "carousel";
	if (lower.includes("tv") || lower.includes("igtv")) return "tv";
	return "post";
}

function normalizeOwner(raw: Record<string, unknown>): InstagramOwner {
	// apify/instagram-scraper exposes flat ownerUsername/ownerFullName fields;
	// apidojo/instagram-scraper-api nests them under `owner`. Accept both.
	const owner =
		asRecord(raw.owner) ?? asRecord(raw.user) ?? asRecord(raw.author) ?? {};
	return {
		username:
			asString(owner.username) ??
			asString(raw.ownerUsername) ??
			asString(raw.username),
		fullName:
			asString(owner.fullName) ??
			asString(owner.full_name) ??
			asString(raw.ownerFullName) ??
			null,
		isVerified:
			asBool(owner.isVerified) ??
			asBool(owner.is_verified) ??
			asBool(raw.isVerified) ??
			null,
		followerCount:
			asNumber(owner.followerCount) ??
			asNumber(owner.followers_count) ??
			asNumber(owner.followers) ??
			asNumber(raw.ownerFollowersCount) ??
			null,
		profilePicUrl:
			asString(owner.profilePicUrl) ??
			asString(owner.profile_pic_url) ??
			asString(owner.profilePicture) ??
			asString(raw.ownerProfilePicUrl) ??
			null,
	};
}

function normalizeLocation(
	raw: Record<string, unknown>,
): InstagramLocation | null {
	const loc = asRecord(raw.location);
	const flatName = asString(raw.locationName);
	const flatId = asString(raw.locationId);
	if (!loc && !flatName && !flatId) return null;
	return {
		id: (loc && (asString(loc.id) ?? asString(loc.pk))) ?? flatId,
		name: (loc && asString(loc.name)) ?? flatName,
		lat: (loc && (asNumber(loc.lat) ?? asNumber(loc.latitude))) ?? null,
		lng: (loc && (asNumber(loc.lng) ?? asNumber(loc.longitude))) ?? null,
	};
}

function normalizeAssets(raw: Record<string, unknown>): InstagramMediaAsset[] {
	const out: InstagramMediaAsset[] = [];
	const seen = new Set<string>();
	const push = (asset: InstagramMediaAsset) => {
		if (!asset.url || seen.has(asset.url)) return;
		seen.add(asset.url);
		out.push(asset);
	};

	const carousel =
		asArray(raw.carouselMedia).length > 0
			? asArray(raw.carouselMedia)
			: asArray(raw.childPosts);
	for (const item of carousel) {
		const child = asRecord(item);
		if (!child) continue;
		const isVideo = asBool(child.isVideo) ?? false;
		push({
			type: isVideo ? "video" : "image",
			url:
				asString(child.displayUrl) ??
				asString(child.imageUrl) ??
				asString(child.videoUrl) ??
				asString(child.url),
			width: asNumber(child.dimensionsWidth) ?? asNumber(child.width),
			height: asNumber(child.dimensionsHeight) ?? asNumber(child.height),
			duration: asNumber(child.videoDuration) ?? asNumber(child.duration),
		});
	}

	const video = asRecord(raw.video);
	if (video) {
		push({
			type: "video",
			url: asString(video.url) ?? asString(raw.videoUrl),
			width: asNumber(video.width),
			height: asNumber(video.height),
			duration: asNumber(video.duration),
		});
	} else if (asString(raw.videoUrl)) {
		push({
			type: "video",
			url: asString(raw.videoUrl),
			width: asNumber(raw.dimensionsWidth),
			height: asNumber(raw.dimensionsHeight),
			duration: asNumber(raw.videoDuration),
		});
	}

	// apify/instagram-scraper exposes an `images` array of CDN URLs in addition
	// to `displayUrl`. Prefer displayUrl; fall back to the first image.
	const imagesArray = asArray(raw.images);
	const firstImage =
		imagesArray.length > 0 && typeof imagesArray[0] === "string"
			? (imagesArray[0] as string)
			: null;
	const display =
		asString(raw.displayUrl) ??
		asString(raw.imageUrl) ??
		asString(raw.thumbnailUrl) ??
		firstImage;
	if (display) {
		push({
			type: "image",
			url: display,
			width: asNumber(raw.dimensionsWidth),
			height: asNumber(raw.dimensionsHeight),
			duration: null,
		});
	}

	return out;
}

export function normalizeApifyItem(item: unknown): InstagramEvidence {
	const raw = asRecord(item) ?? {};
	const caption =
		asString(raw.caption) ??
		asString((asRecord(raw.caption) as Record<string, unknown> | null)?.text);
	const shortcode =
		asString(raw.shortCode) ?? asString(raw.code) ?? asString(raw.shortcode);
	const url =
		asString(raw.url) ??
		(shortcode ? `https://www.instagram.com/p/${shortcode}/` : "");
	const assets = normalizeAssets(raw);
	const primaryImage =
		assets.find((a) => a.type === "image" && a.url)?.url ?? null;
	const primaryVideo =
		assets.find((a) => a.type === "video" && a.url)?.url ?? null;

	return {
		shortcode,
		id: asString(raw.id) ?? asString(raw.pk),
		url,
		postType: detectPostType(raw),
		createdAt:
			asString(raw.createdAt) ??
			asString(raw.takenAt) ??
			asString(raw.timestamp),

		likeCount: asNumber(raw.likeCount) ?? asNumber(raw.likesCount),
		commentCount: asNumber(raw.commentCount) ?? asNumber(raw.commentsCount),
		playCount:
			asNumber(raw.playCount) ??
			asNumber(
				(asRecord(raw.video) as Record<string, unknown> | null)?.playCount,
			),
		viewCount: asNumber(raw.viewCount) ?? asNumber(raw.videoViewCount),

		caption,
		hashtags:
			asArray(raw.hashtags).filter((t): t is string => typeof t === "string")
				.length > 0
				? (
						asArray(raw.hashtags).filter(
							(t): t is string => typeof t === "string",
						) as string[]
					).map((t) => t.replace(/^#/, "").toLowerCase())
				: extractHashtags(caption),
		mentions:
			asArray(raw.mentions).filter((t): t is string => typeof t === "string")
				.length > 0
				? (
						asArray(raw.mentions).filter(
							(t): t is string => typeof t === "string",
						) as string[]
					).map((m) => m.replace(/^@/, "").toLowerCase())
				: extractMentions(caption),

		primaryImageUrl: primaryImage,
		primaryVideoUrl: primaryVideo,
		assets,

		owner: normalizeOwner(raw),
		location: normalizeLocation(raw),

		raw,
	};
}
