// Thin wrapper around ApifyClient for the Instagram pipeline. Keeps env
// resolution and actor selection in one place so the runner can stay focused
// on prompting and digestion.

import { ApifyClient } from "apify-client";
import { type InstagramEvidence, normalizeApifyItem } from "./types";

const DEFAULT_ACTOR_ID = "shu8hvrXbJbY3Eb9W"; // apify/instagram-scraper

export type ApifyConfig = {
	token: string;
	actorId: string;
	maxItems: number;
	waitSecs: number;
};

export function resolveApifyToken(): string | undefined {
	return process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN;
}

export function requireApifyToken(): string {
	const token = resolveApifyToken();
	if (!token) {
		throw new Error(
			"APIFY_TOKEN environment variable required for Instagram ingest (see .env.example)",
		);
	}
	return token;
}

export function getApifyConfig(): ApifyConfig {
	return {
		token: requireApifyToken(),
		actorId: process.env.INSTAGRAM_ACTOR_ID?.trim() || DEFAULT_ACTOR_ID,
		maxItems: Math.max(1, Number(process.env.INSTAGRAM_MAX_ITEMS ?? "1") || 1),
		waitSecs: Math.max(
			30,
			Number(process.env.INSTAGRAM_WAIT_SECS ?? "120") || 120,
		),
	};
}

export type FetchInstagramOptions = {
	url: string;
};

export type FetchInstagramResult = {
	evidence: InstagramEvidence;
	actorId: string;
	runId: string;
	datasetId: string;
};

export async function fetchInstagramEvidence(
	options: FetchInstagramOptions,
): Promise<FetchInstagramResult> {
	const config = getApifyConfig();
	const client = new ApifyClient({ token: config.token });
	const run = await client.actor(config.actorId).call(
		{
			directUrls: [options.url],
			resultsType: "posts",
			resultsLimit: config.maxItems,
			addParentData: false,
		},
		{ waitSecs: config.waitSecs },
	);
	if (run.status !== "SUCCEEDED") {
		throw new Error(
			`Apify run ${run.id} ended with status ${run.status} (statusMessage=${run.statusMessage ?? "n/a"})`,
		);
	}
	const { items } = await client.dataset(run.defaultDatasetId).listItems({
		limit: config.maxItems,
	});
	const first = items[0];
	if (!first) {
		throw new Error(
			`Apify run ${run.id} produced no dataset items (defaultDatasetId=${run.defaultDatasetId})`,
		);
	}
	return {
		evidence: normalizeApifyItem(first),
		actorId: config.actorId,
		runId: run.id,
		datasetId: run.defaultDatasetId,
	};
}
