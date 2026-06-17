// Realtime nudge channel. Holds an SSE connection to /api/app/posts/stream and,
// on each (re)connect AND each "change" event, triggers a delta pull. The nudge
// itself carries no post data — the pull is the source of truth — so a dropped
// or coalesced nudge can never lose data; at worst it delays a pull by the
// debounce window.
//
// We disable react-native-sse's built-in reconnect (pollingInterval: 0) and
// manage it here so each reconnect rebuilds with a FRESH auth cookie (the cookie
// can rotate) and uses exponential backoff + jitter.
import EventSource from "react-native-sse";

import { refreshSession } from "@/lib/api";
import { authBaseURL, authClient } from "@/lib/auth-client";
import { pullChanges } from "./changes-pull";

const STREAM_PATH = "/api/app/posts/stream";
const MAX_BACKOFF_MS = 30_000;
const PULL_DEBOUNCE_MS = 300;

let source: EventSource<"change"> | null = null;
let active = false;
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Coalesce bursts of nudges (and the open-time catch-up) into one pull.
function schedulePull(): void {
  if (pullTimer) return;
  pullTimer = setTimeout(() => {
    pullTimer = null;
    void pullChanges().catch((err) => {
      console.warn("[sync] pull after nudge failed", err);
    });
  }, PULL_DEBOUNCE_MS);
}

function scheduleReconnect(): void {
  if (!active || reconnectTimer) return;
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
  const delay = base / 2 + Math.random() * (base / 2); // jitter in [base/2, base)
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void open();
  }, delay);
}

async function open(): Promise<void> {
  if (!active) return;
  // On a reconnect (a prior connection errored — most often a 401 from a cookie
  // that rotated server-side), force a single-flight session re-check first so
  // getCookie() below returns the refreshed token. Without this the stream just
  // reconnects with the same stale cookie and 401-loops. EventSource gives us no
  // status code, so we can't tell a 401 from any other drop — refreshing on
  // every reconnect is cheap (single-flight, shared with apiGet) and harmless.
  if (attempts > 0) {
    await refreshSession();
    if (!active) return; // disconnected while awaiting the recheck
  }
  const cookie = authClient.getCookie();
  if (!cookie) {
    // Not signed in yet — retry later (sign-in will have a cookie by then).
    scheduleReconnect();
    return;
  }

  source?.removeAllEventListeners();
  source?.close();

  source = new EventSource<"change">(`${authBaseURL}${STREAM_PATH}`, {
    headers: { Cookie: cookie },
    pollingInterval: 0, // we own reconnection
  });

  source.addEventListener("open", () => {
    attempts = 0;
    // Catch up on anything missed while disconnected, THEN trust live nudges.
    schedulePull();
  });

  source.addEventListener("change", () => {
    schedulePull();
  });

  source.addEventListener("error", () => {
    source?.removeAllEventListeners();
    source?.close();
    source = null;
    scheduleReconnect();
  });
}

export function connectSse(): void {
  if (active) return; // already connected or mid-backoff
  active = true;
  attempts = 0;
  void open();
}

export function disconnectSse(): void {
  active = false;
  clearReconnect();
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
  source?.removeAllEventListeners();
  source?.close();
  source = null;
  attempts = 0;
}
