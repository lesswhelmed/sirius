// Offline outbox for note-kind ingest submissions. Notes (including locally
// drafted ones) are pure JSON, so when the network is down they're queued here
// and flushed later — capture works fully offline. Binary kinds (images,
// video, audio files) need multipart uploads and stay online-only.
//
// Idempotency: the server dedups by contentHash (urls + notes), so an item
// that actually reached the server before the connection dropped simply
// dedupes when retried.
import {
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { ApiError, apiPostJson } from "@/lib/api";
import type { SubmitOk } from "@/lib/ingest-submit";

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

const OUTBOX_PATH = `${documentDirectory}outbox.json`;

async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await readAsStringAsync(OUTBOX_PATH);
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]): Promise<void> {
  await writeAsStringAsync(OUTBOX_PATH, JSON.stringify(items));
}

export async function enqueueOutbox(body: OutboxBody): Promise<void> {
  const items = await readOutbox();
  items.push({
    // Math.random suffix avoids collisions when two notes enqueue in the same ms.
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    body,
  });
  await writeOutbox(items);
}

export async function countOutbox(): Promise<number> {
  return (await readOutbox()).length;
}

let flushing: Promise<{ sent: number; remaining: number }> | null = null;

// Sends queued items FIFO. A 4xx response means the item can never succeed
// (validation) — it's dropped. A network failure or 5xx stops the flush; the
// item stays queued for the next trigger (app start, connectivity change,
// next successful submit). Serialized so overlapping triggers don't double-send.
export function flushOutbox(): Promise<{ sent: number; remaining: number }> {
  if (flushing) {
    return flushing;
  }
  flushing = (async () => {
    let items = await readOutbox();
    let sent = 0;
    while (items.length > 0) {
      const item = items[0]!;
      try {
        await apiPostJson<SubmitOk>(
          "/api/app/ingest",
          // OutboxBody is JSON-shaped by construction; apiPostJson's Json type
          // can't see through `draft: unknown`.
          item.body as Parameters<typeof apiPostJson>[1]
        );
        sent++;
        items = items.slice(1);
        await writeOutbox(items);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // Permanent rejection — retrying forever won't heal a 4xx.
          console.warn(
            `[outbox] dropping rejected item (${err.status}): ${err.message}`
          );
          items = items.slice(1);
          await writeOutbox(items);
          continue;
        }
        // Offline or server trouble: keep the item, try again on a later trigger.
        item.attempts += 1;
        await writeOutbox(items);
        break;
      }
    }
    return { sent, remaining: items.length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
