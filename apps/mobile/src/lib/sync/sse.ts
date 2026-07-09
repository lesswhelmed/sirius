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

import { checkServerSession, recoverWedgedAuthCookie } from "@/lib/api";
import { authBaseURL, authClient, signOut } from "@/lib/auth-client";
import { pullChanges } from "./changes-pull";
import { pullCommentChanges } from "./comment-changes-pull";
import { pullReflectionChanges } from "./reflection-changes-pull";
import { handleRejectedNudge } from "./rejected";

const STREAM_PATH = "/api/app/posts/stream";
const MAX_BACKOFF_MS = 30_000;
const PULL_DEBOUNCE_MS = 300;
// Reconnect attempts of persistent "unknown" session checks before we treat the
// stored cookie as wedged and attempt a toxic-cookie reset (≈15s of backoff).
const STUCK_RESET_AFTER_ATTEMPTS = 4;

// Custom server-sent event names this stream relays beyond the built-ins.
type StreamEvent = "change" | "submission-rejected";

let source: EventSource<StreamEvent> | null = null;
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

// Coalesce bursts of nudges (and the open-time catch-up) into one pull. A single
// `change` event covers every channel the stream route relays (posts, comments,
// and — once its LISTEN channel lands server-side — reflections), so pull all
// three feeds; each is self-serialized and independent, and an extra pull is a
// cheap empty page.
function schedulePull(): void {
  if (pullTimer) return;
  pullTimer = setTimeout(() => {
    pullTimer = null;
    void pullChanges().catch((err) => {
      console.warn("[sync] pull after nudge failed", err);
    });
    void pullCommentChanges().catch((err) => {
      console.warn("[sync] comment pull after nudge failed", err);
    });
    void pullReflectionChanges().catch((err) => {
      console.warn("[sync] reflection pull after nudge failed", err);
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
  // Confirm the session against the server before EVERY (re)open — including the
  // first. useSession() shows the locally cached session, so the stored cookie
  // can already be stale server-side on a cold start / foreground; opening blind
  // would 401 on every app-open before recovery kicks in. The check is a
  // single-flight (shared with apiGet) and refreshes getCookie() below to the
  // rotated token. EventSource gives us no status code, so we can't tell a 401
  // from any other drop — re-checking is cheap and harmless.
  //
  // AUTHORITATIVELY "none" (server replied: no session) → stop reconnecting with
  // a dead cookie and clear local auth so the gate routes to sign-in instead of
  // looping. A transient "unknown" (network) falls through to an optimistic
  // open + normal backoff so a flaky network never logs the user out.
  const state = await checkServerSession();
  if (!active) return; // disconnected while awaiting the recheck
  if (state === "none") {
    disconnectSse();
    void signOut().catch(() => {});
    return;
  }
  // Circuit breaker for the toxic-cookie loop: when we've been reconnecting a
  // while and the session check keeps throwing ("unknown" — never a clean
  // "none"), a corrupt/oversized stored cookie is wedging every request and the
  // stream would 401-reconnect forever. recoverWedgedAuthCookie clears that
  // storage ONLY when the cookie is genuinely suspicious AND the server is
  // reachable without it (offline stays untouched); on success, sign out so the
  // user re-auths cleanly. EventSource bypasses apiGet's runWithAuthRetry, so
  // this is the only place the SSE path gets that recovery.
  if (state === "unknown" && attempts >= STUCK_RESET_AFTER_ATTEMPTS) {
    const recovered = await recoverWedgedAuthCookie("sse-stuck-loop");
    if (!active) return;
    if (recovered) {
      disconnectSse();
      void signOut().catch(() => {});
      return;
    }
  }
  const cookie = authClient.getCookie();
  if (!cookie) {
    // Not signed in yet — retry later (sign-in will have a cookie by then).
    scheduleReconnect();
    return;
  }

  source?.removeAllEventListeners();
  source?.close();

  source = new EventSource<StreamEvent>(`${authBaseURL}${STREAM_PATH}`, {
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

  // A submission was rejected (content-safety flag) — it produced NO post, so it
  // can't ride the `change` re-pull. Drop the matching optimistic row directly
  // using the reconciliation key the worker resolved for us.
  source.addEventListener("submission-rejected", (event) => {
    const data = (event as { data?: string | null }).data;
    if (!data) return;
    try {
      const payload = JSON.parse(data) as { submissionId?: string };
      if (payload.submissionId) {
        void handleRejectedNudge(payload.submissionId).catch((err) =>
          console.warn("[sync] rejected nudge failed", err),
        );
      }
    } catch {
      // Malformed payload — ignore rather than tear down the stream.
    }
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
