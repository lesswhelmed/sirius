// Swappable tweet-fetch providers. Each Apify tweet-scraper actor takes a
// different input shape (kaito wants `tweetIDs`, apidojo wants `startUrls`) and
// may emit a slightly different item shape — so a provider is the seam that
// isolates those differences. Switching actors is then config, not code:
//
//   - set X_PROVIDER=apidojo to use a registered alternate, or
//   - set X_ACTOR_ID=<id> to point the active provider at a different actor, or
//   - add a new TweetProvider object to TWEET_PROVIDERS to onboard another actor
//     (its own buildInput + optional normalize) without touching apify.ts.
//
// The rest of the pipeline depends only on the TweetProvider interface and the
// normalized TwitterEvidence, never on a specific actor.

import type { TwitterUrlParse } from "../../lib/twitter-url";
import type { TwitterEvidence } from "./types";

export type TweetProvider = {
  // Stable key for logs, provenance, and X_PROVIDER selection.
  name: string;
  // Default Apify actor id; X_ACTOR_ID overrides it at runtime.
  defaultActorId: string;
  // Map one parsed tweet into this actor's run input.
  buildInput(parse: TwitterUrlParse, maxItems: number): Record<string, unknown>;
  // Optional per-actor normalizer; defaults to the shared defensive one.
  normalize?(item: unknown): TwitterEvidence;
};

// kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest.
// `tweetIDs` overrides all other filters and returns exactly those tweets, so
// maxItems (min 20 on this actor, and search-only) is intentionally omitted.
export const kaitoProvider: TweetProvider = {
  name: "kaito",
  defaultActorId: "CJdippxWmn9uRfooo",
  buildInput: (parse) => ({ tweetIDs: [parse.tweetId] }),
};

// apidojo/twitter-scraper-lite (actor nfp1fpt5gUlBwPcor). Fetches a single tweet
// by its canonical URL via startUrls. DEFAULT provider — used for single posts.
// (Distinct from apidojo/tweet-scraper "V2" = actor 61RPP7dywgiy0JPD0.)
export const apidojoProvider: TweetProvider = {
  name: "apidojo",
  defaultActorId: "nfp1fpt5gUlBwPcor",
  buildInput: (parse, maxItems) => ({
    startUrls: [parse.canonicalUrl],
    maxItems,
  }),
};

export const TWEET_PROVIDERS: Record<string, TweetProvider> = {
  kaito: kaitoProvider,
  apidojo: apidojoProvider,
};

// Default: apidojo/twitter-scraper-lite (fetches a single tweet by canonical
// URL). Set X_PROVIDER=kaito to fall back to the kaito pay-per-result actor.
export const DEFAULT_PROVIDER = apidojoProvider;

export function resolveTweetProvider(): TweetProvider {
  const key = process.env.X_PROVIDER?.trim().toLowerCase();
  if (key) {
    const provider = TWEET_PROVIDERS[key];
    if (provider) {
      return provider;
    }
    console.warn(
      `[twitter] unknown X_PROVIDER="${key}"; using ${DEFAULT_PROVIDER.name}. Known: ${Object.keys(TWEET_PROVIDERS).join(", ")}`,
    );
  }
  return DEFAULT_PROVIDER;
}
