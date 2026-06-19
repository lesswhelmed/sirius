// Wire + evidence types shared by the web preview endpoint and the worker's
// GitHub runner, plus typed errors the callers map to HTTP statuses / fallback.

export type RepoPreview = {
	owner: string;
	repo: string;
	ownerAvatarUrl: string | null;
	description: string | null;
	stars: number;
	primaryLanguage: string | null;
	// Language names from the GitHub languages breakdown, most-bytes first.
	languages: string[];
	topics: string[];
	license: string | null;
	defaultBranch: string;
	// ISO timestamp of the last push, or null if unavailable.
	pushedAt: string | null;
	homepage: string | null;
	htmlUrl: string;
	// First ~800 chars of the README, for the preview card.
	readmeExcerpt: string | null;
	// The curated files the worker will actually read (paths only). Surfaced in
	// the preview so the user can see what "full repository" resolves to.
	keyFilePaths: string[];
};

export type RepoKeyFile = {
	path: string;
	// Byte length of the (possibly truncated) content below.
	bytes: number;
	content: string;
};

// Everything the preview carries, plus the full (capped) README and the bytes
// of the selected key files — the worker's structuring input.
export type RepoEvidence = RepoPreview & {
	readme: string | null;
	keyFiles: RepoKeyFile[];
};

// 403/429 with x-ratelimit-remaining: 0 — the unauthenticated 60/hr ceiling.
// Web endpoint → 429; worker → swallow and fall back to url_context.
export class GitHubRateLimitedError extends Error {
	readonly retryAfterMs: number | null;
	constructor(retryAfterMs: number | null) {
		super("GitHub API rate limit exceeded");
		this.name = "GitHubRateLimitedError";
		this.retryAfterMs = retryAfterMs;
	}
}

// Repo missing or private (404). Web endpoint → 422 "is it public?".
export class GitHubNotFoundError extends Error {
	constructor(slug: string) {
		super(`repository not found or not public: ${slug}`);
		this.name = "GitHubNotFoundError";
	}
}

// Any other non-OK GitHub response.
export class GitHubFetchError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "GitHubFetchError";
		this.status = status;
	}
}
