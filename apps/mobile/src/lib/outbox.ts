// Offline outbox for note-kind ingest submissions. Notes (including locally
// drafted ones) are pure JSON, so when the network is down they're queued and
// flushed later — capture works fully offline. Binary kinds (images, video,
// audio files) need multipart uploads and stay online-only for now.
//
// Backed by the local SQLite `pending_submissions` table (the unified outbox),
// NOT the old outbox.json file. This module keeps its original public API as a
// thin wrapper so existing call sites keep working; the on-launch
// importLegacyOutboxOnce() migrates any leftover outbox.json rows once, then
// deletes the file.
//
// Idempotency: the server dedups by contentHash (urls + notes), so an item that
// actually reached the server before the connection dropped simply dedupes when
// retried.

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import {
	deleteAsync,
	documentDirectory,
	getInfoAsync,
	readAsStringAsync,
} from "expo-file-system/legacy";

import { ApiError, apiPostJson } from "@/lib/api";
import { db } from "@/lib/db/client";
import { pendingSubmissions } from "@/lib/db/schema";
import type { SubmitOk } from "@/lib/ingest-submit";
import { linkSubmission } from "@/lib/sync/writes";

// Exact JSON body for POST /api/app/ingest.
export type OutboxBody = {
	urls: string[];
	notes: string;
	force: boolean;
	projectId?: string;
	draft?: unknown;
};

export type OutboxItem = {
	id: string;
	createdAt: string;
	attempts: number;
	body: OutboxBody;
};

// Enqueue a note/url ingest body for later replay. `localId` links the queued
// submission to its optimistic post row once that exists (Step 4); standalone
// enqueues (today's path) get a fresh id with no post yet.
export async function enqueueOutbox(
	body: OutboxBody,
	localId: string = randomUUID(),
): Promise<void> {
	await db.insert(pendingSubmissions).values({
		id: randomUUID(),
		localId,
		transport: "ingest",
		requestJson: body,
		attempts: 0,
		status: "queued",
		createdAt: new Date(),
	});
}

export async function countOutbox(): Promise<number> {
	const rows = await db
		.select({ id: pendingSubmissions.id })
		.from(pendingSubmissions)
		.where(
			and(
				eq(pendingSubmissions.transport, "ingest"),
				eq(pendingSubmissions.status, "queued"),
			),
		);
	return rows.length;
}

// One-time migration of a leftover outbox.json into pending_submissions. Safe to
// call repeatedly: it no-ops once the file is gone. Runs before the first flush.
const LEGACY_OUTBOX_PATH = `${documentDirectory}outbox.json`;
let legacyImported = false;

async function importLegacyOutboxOnce(): Promise<void> {
	if (legacyImported) return;
	legacyImported = true;
	try {
		const info = await getInfoAsync(LEGACY_OUTBOX_PATH);
		if (!info.exists) return;
		const raw = await readAsStringAsync(LEGACY_OUTBOX_PATH);
		const parsed = JSON.parse(raw) as unknown;
		const items = Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
		for (const item of items) {
			if (!item?.body) continue;
			await db.insert(pendingSubmissions).values({
				id: randomUUID(),
				localId: randomUUID(),
				transport: "ingest",
				requestJson: item.body,
				attempts: item.attempts ?? 0,
				status: "queued",
				createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
			});
		}
		await deleteAsync(LEGACY_OUTBOX_PATH, { idempotent: true });
	} catch (err) {
		console.warn("[outbox] legacy outbox.json import failed", err);
	}
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

// Sends queued note/url items FIFO. A 4xx response means the item can never
// succeed (validation) — it's dropped. A network failure or 5xx stops the flush;
// the item stays queued for the next trigger (app start, connectivity change,
// next successful submit). Serialized so overlapping triggers don't double-send.
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
	if (flushing) {
		return flushing;
	}
	flushing = (async () => {
		await importLegacyOutboxOnce();
		let sent = 0;
		// Re-read the head each iteration so newly enqueued items are picked up and
		// deletions are reflected without juggling an in-memory copy.
		for (;;) {
			const [row] = await db
				.select()
				.from(pendingSubmissions)
				.where(
					and(
						eq(pendingSubmissions.transport, "ingest"),
						eq(pendingSubmissions.status, "queued"),
					),
				)
				.orderBy(asc(pendingSubmissions.createdAt))
				.limit(1);
			if (!row) break;
			try {
				const ok = await apiPostJson<SubmitOk>(
					"/api/app/ingest",
					// requestJson is JSON-shaped by construction; apiPostJson's Json type
					// can't see through the stored `unknown`.
					row.requestJson as Parameters<typeof apiPostJson>[1],
				);
				// Link the optimistic post row (if this submission came from an
				// on-device draft) to its server submission, so the canonical post
				// reconciles back into the same card. No-op for standalone enqueues.
				await linkSubmission(row.localId, ok.id);
				sent++;
				await db
					.delete(pendingSubmissions)
					.where(eq(pendingSubmissions.id, row.id));
			} catch (err) {
				if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
					// Permanent rejection — retrying forever won't heal a 4xx.
					console.warn(
						`[outbox] dropping rejected item (${err.status}): ${err.message}`,
					);
					await db
						.delete(pendingSubmissions)
						.where(eq(pendingSubmissions.id, row.id));
					continue;
				}
				// Offline or server trouble: keep the item, try again on a later trigger.
				await db
					.update(pendingSubmissions)
					.set({
						attempts: row.attempts + 1,
						lastError:
							err instanceof ApiError
								? `server error (${err.status})`
								: "no connection",
					})
					.where(eq(pendingSubmissions.id, row.id));
				break;
			}
		}
		const remaining = await countOutbox();
		return { sent, remaining };
	})().finally(() => {
		flushing = null;
	});
	return flushing;
}
