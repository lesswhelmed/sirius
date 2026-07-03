// Share-intent breadcrumb trail for diagnosing lost/misrouted shares in the
// field (companion to crash-log.ts, which covers crashes).
//
// Why this exists: the iOS share extension hands off to the host app via a
// deep-link URL that is intermittently lost when the app is warm, and the
// fallback paths (+native-intent rewrite, context flip, outbox flush) are all
// invisible after the fact. Each hop logs a breadcrumb here so a tester can
// read back the sequence (which layer fired, which skipped, and why) even when
// they can't pull device logs.
//
// PRIVACY: breadcrumbs record tags + coarse flags/counts ONLY — never the
// shared payload (no URLs, no text, no file names).
//
// Persistence is a ring buffer (~50 entries) in share-breadcrumbs.json under
// documentDirectory. Writes are async and serialized through a promise chain
// (breadcrumbs have no abort race to win, unlike crash records); every entry
// point swallows its own errors — instrumentation must never break a share.
import {
  documentDirectory,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

export type ShareEventDetail = Record<
  string,
  string | number | boolean | null | undefined
>;

export type ShareBreadcrumb = {
  tag: string;
  detail?: ShareEventDetail;
  at: string;
};

const BREADCRUMBS_PATH = `${documentDirectory}share-breadcrumbs.json`;
const MAX_BREADCRUMBS = 50;

// In-memory buffer, hydrated from disk once per session. `null` = not loaded.
let buffer: ShareBreadcrumb[] | null = null;
// Serializes load + appends so concurrent logShareEvent calls can't interleave
// their read-modify-write cycles and drop entries.
let chain: Promise<void> = Promise.resolve();

async function loadOnce(): Promise<ShareBreadcrumb[]> {
  if (buffer) return buffer;
  try {
    const raw = await readAsStringAsync(BREADCRUMBS_PATH);
    const parsed = JSON.parse(raw) as unknown;
    buffer = Array.isArray(parsed)
      ? (parsed as ShareBreadcrumb[]).slice(-MAX_BREADCRUMBS)
      : [];
  } catch {
    // Missing / unreadable file — start fresh.
    buffer = [];
  }
  return buffer;
}

// Appends one breadcrumb (fire-and-forget). Never throws; never blocks the
// caller. `detail` must hold flags/counts only — NEVER share payload content.
export function logShareEvent(tag: string, detail?: ShareEventDetail): void {
  try {
    // Greppable in Metro / device logs alongside the persisted trail.
    console.log(`[share:${tag}]`, detail ?? "");
    const entry: ShareBreadcrumb = {
      tag,
      ...(detail ? { detail } : {}),
      // ISO string keeps the trail human-readable (app code — the
      // workflow-script Date ban does not apply here).
      at: new Date().toISOString(),
    };
    chain = chain
      .then(async () => {
        const entries = await loadOnce();
        entries.push(entry);
        if (entries.length > MAX_BREADCRUMBS) {
          entries.splice(0, entries.length - MAX_BREADCRUMBS);
        }
        await writeAsStringAsync(BREADCRUMBS_PATH, JSON.stringify(entries));
      })
      .catch(() => {
        // Disk unavailable — the in-memory buffer (if hydrated) still serves
        // same-session reads.
      });
  } catch {
    // Swallow — instrumentation must never make things worse.
  }
}

// Reads the trail, oldest first (empty if none / unreadable). Waits for any
// in-flight appends so a diagnostics screen sees the latest entries.
export async function readShareBreadcrumbs(): Promise<ShareBreadcrumb[]> {
  try {
    await chain;
    return [...(await loadOnce())];
  } catch {
    return [];
  }
}
