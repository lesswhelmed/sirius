// Thin wrapper around ApifyClient for the X / Twitter pipeline. Mirrors
// instagram/apify.ts but stays actor-agnostic: the active TweetProvider
// (see providers.ts) supplies the actor id, the run input, and an optional
// normalizer, so swapping the underlying scraper is config — not a code change
// here. Reuses the shared APIFY_TOKEN resolver so token handling lives in one
// place.

import { ApifyClient } from "apify-client";
import type { TwitterUrlParse } from "../../lib/twitter-url";
import { requireApifyToken } from "../instagram/apify";
import { resolveTweetProvider, type TweetProvider } from "./providers";
import { normalizeApifyItem, type TwitterEvidence } from "./types";

export type TwitterApifyConfig = {
  token: string;
  provider: TweetProvider;
  actorId: string;
  maxItems: number;
  waitSecs: number;
};

export function getTwitterApifyConfig(): TwitterApifyConfig {
  const provider = resolveTweetProvider();
  return {
    token: requireApifyToken(),
    provider,
    actorId: process.env.X_ACTOR_ID?.trim() || provider.defaultActorId,
    maxItems: Math.max(1, Number(process.env.X_MAX_ITEMS ?? "1") || 1),
    waitSecs: Math.max(30, Number(process.env.X_WAIT_SECS ?? "120") || 120),
  };
}

export type FetchTwitterOptions = {
  parse: TwitterUrlParse;
};

export type FetchTwitterResult = {
  evidence: TwitterEvidence;
  provider: string;
  actorId: string;
  runId: string;
  datasetId: string;
};

export async function fetchTwitterEvidence(
  options: FetchTwitterOptions,
): Promise<FetchTwitterResult> {
  const config = getTwitterApifyConfig();
  const client = new ApifyClient({ token: config.token });
  const input = config.provider.buildInput(options.parse, config.maxItems);
  const run = await client
    .actor(config.actorId)
    .call(input, { waitSecs: config.waitSecs });
  if (run.status !== "SUCCEEDED") {
    throw new Error(
      `Apify run ${run.id} ended with status ${run.status} (statusMessage=${run.statusMessage ?? "n/a"})`,
    );
  }
  const { items } = await client.dataset(run.defaultDatasetId).listItems({
    limit: Math.max(1, config.maxItems),
  });
  const first = items[0];
  if (!first) {
    throw new Error(
      `Apify run ${run.id} produced no dataset items (defaultDatasetId=${run.defaultDatasetId})`,
    );
  }
  const normalize = config.provider.normalize ?? normalizeApifyItem;
  return {
    evidence: normalize(first),
    provider: config.provider.name,
    actorId: config.actorId,
    runId: run.id,
    datasetId: run.defaultDatasetId,
  };
}
