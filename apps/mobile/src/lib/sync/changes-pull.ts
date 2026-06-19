// Delta catch-up pull. Reads the local watermark (the newest server updatedAt
// applied), pages the changes feed, reconciles each change, and advances the
// watermark only after a page is applied. Idempotent and resumable: a crash
// mid-pull just re-pulls from the last committed cursor (reconcile is an
// upsert-by-id, so a re-applied change is harmless).
import { eq } from "drizzle-orm";

import { apiGet } from "@/lib/api";
import { db } from "@/lib/db/client";
import { syncMeta } from "@/lib/db/schema";
import { triggerReindexIfReady } from "@/lib/research/build-index";
import type { PostChangesResult } from "./events";
import { applyTombstone, reconcileUpsert } from "./reconcile";

const SINCE_KEY = "posts.changes.since";
const EPOCH = new Date(0).toISOString();

async function getSince(): Promise<string> {
	const [row] = await db
		.select()
		.from(syncMeta)
		.where(eq(syncMeta.key, SINCE_KEY))
		.limit(1);
	return row?.value ?? EPOCH;
}

async function setSince(value: string): Promise<void> {
	await db
		.insert(syncMeta)
		.values({ key: SINCE_KEY, value })
		.onConflictDoUpdate({ target: syncMeta.key, set: { value } });
}

let pulling: Promise<void> | null = null;

// Serialized: overlapping triggers (SSE nudge + foreground + network) share one
// in-flight pull rather than racing the cursor.
export function pullChanges(): Promise<void> {
	if (pulling) return pulling;
	pulling = (async () => {
		for (;;) {
			const since = await getSince();
			const qs = new URLSearchParams({ since, limit: "200" });
			const result = await apiGet<PostChangesResult>(
				`/api/app/posts/changes?${qs.toString()}`,
			);
			for (const change of result.changes) {
				if (change.op === "upsert") {
					await reconcileUpsert(change.post);
				} else {
					await applyTombstone(change.id, change.deletedAt);
				}
			}
			if (result.nextCursor) {
				await setSince(result.nextCursor);
			}
			// Stop when the server says there's no more, or defensively if a page came
			// back empty (no cursor to advance past).
			if (!result.hasMore || result.changes.length === 0) break;
		}
		// Keep the on-device search index fresh for edited/new posts. No-op (and no
		// model load) unless the embedding model is already downloaded; never awaited
		// so it can't slow the pull.
		void triggerReindexIfReady();
	})().finally(() => {
		pulling = null;
	});
	return pulling;
}
