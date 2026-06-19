import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

import { authBaseURL, authClient, getSession, signOut } from "./auth-client";
import { clearAuthStorage, inspectStoredCookie } from "./auth-recovery";

type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json }
  | Json[];

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Auth retry → logout policy
//
// An authenticated request that comes back 401/403 may be a transient blip or a
// session whose cookie can still refresh, so we don't fail it outright. Instead
// every helper (fetch- and uploadAsync-based) routes its attempt through
// runWithAuthRetry: on 401/403 it force-rechecks the session against the server
// (bypassing better-auth's cookie cache), re-issues the original request when the
// session is valid again, and only signs out — letting the reactive useSession()
// in the root layout redirect to sign-in — after the retries are exhausted.
// ---------------------------------------------------------------------------

const MAX_AUTH_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 4000;

// Single-flight session re-check shared by concurrent 401s, so N simultaneous
// failures collapse into ONE server hit rather than N.
let inFlightState: Promise<SessionState> | null = null;
// Latch: once signOut() has fired, further in-flight requests fail fast (throw
// their own ApiError) without re-triggering signOut(). Reset on any 2xx or a
// recovered session.
let loggedOut = false;

// Same exponential-backoff-with-jitter shape as src/lib/sync/sse.ts.
function authBackoff(attempt: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2); // jitter in [base/2, base)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Probe the auth server with a BARE fetch — a raw fetch() bypasses the
// better-auth client's cookie-attaching plugin, so it carries no stored cookie.
// fetch() only rejects on a transport failure; any resolved response (even a
// 401) means the server is reachable. Used to tell "the stored cookie is toxic"
// (server reachable, but our cookie'd request died at the transport layer) from
// "we're simply offline" (probe also fails).
async function serverReachableWithoutCookie(): Promise<boolean> {
  try {
    await fetch(`${authBaseURL}/api/auth/get-session`, { method: "GET" });
    return true;
  } catch {
    return false;
  }
}

// Tri-state result of a forced server session check. "none" is AUTHORITATIVE —
// the server replied and there is no session, so callers may safely log out;
// "unknown" is a transient failure (network error / thrown request) where we
// must NOT log the user out, only back off and retry. Collapsing these two into
// a single boolean (the old behavior) would log a user out on any flaky network.
export type SessionState = "valid" | "none" | "unknown";

// Force a server-side session check, bypassing the cookie cache. A "valid"
// re-check refreshes the stored cookie so the next `$fetch` (whose expo plugin
// attaches the cookie via getCookie()) picks up the rotated value. Concurrent
// callers (apiGet retries, the SSE channel, foreground revalidation) share one
// in-flight promise.
export function checkServerSession(): Promise<SessionState> {
  if (!inFlightState) {
    inFlightState = getSession({ query: { disableCookieCache: true } })
      .then(({ data }): SessionState => (data != null ? "valid" : "none"))
      .catch((): SessionState => "unknown")
      .finally(() => {
        inFlightState = null;
      });
  }
  return inFlightState;
}

function recheckSession(): Promise<boolean> {
  return checkServerSession().then((state) => state === "valid");
}

// Force a server-side session check (single-flight), refreshing the stored
// cookie if it rotated. Exposed for non-apiGet callers — the SSE channel uses
// it to recover a rotated cookie before reconnecting, since EventSource has no
// access to runWithAuthRetry. Resolves true if the session is still valid.
export function refreshSession(): Promise<boolean> {
  return recheckSession();
}

// Core retry runner. `perform` is a thunk that runs ONE attempt and either
// returns the parsed result or throws — an ApiError carrying status 401/403
// triggers the retry/logout policy; anything else propagates immediately. The
// thunk must rebuild its own headers each call so a refreshed cookie is used.
async function runWithAuthRetry<T>(perform: () => Promise<T>): Promise<T> {
  // One-shot guard: a toxic stored cookie is cleared at most once per call so a
  // failure that ISN'T the cookie can't spin this loop.
  let triedCookieReset = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await perform();
      // A successful request means the session is healthy again.
      loggedOut = false;
      return result;
    } catch (err) {
      const status =
        err instanceof ApiError ? err.status : undefined;
      if (status !== 401 && status !== 403) {
        // A transport-level failure (no HTTP status — fetch threw) caused by a
        // toxic persisted cookie poisoning the request headers (see
        // plans/auth-is-broken-on-swift-noodle.md): the request never leaves the
        // device, persists across relaunches, and only a storage wipe recovers.
        // Recover ONLY when the stored cookie is actually suspicious — corrupt
        // bytes, or abnormally large (a header-size failure) — so a normal
        // transient blip with a valid cookie still behaves as before and never
        // forces a surprise logout. Confirm with a bare, cookie-free probe that
        // the server is reachable (else we're just offline → rethrow untouched),
        // then clear the cookie once and retry so the request goes out clean.
        if (status === undefined && !triedCookieReset) {
          const cookie = inspectStoredCookie();
          const suspicious = cookie.toxic || cookie.len > 4096;
          if (suspicious && (await serverReachableWithoutCookie())) {
            triedCookieReset = true;
            await clearAuthStorage("api-transport-failure");
            continue;
          }
        }
        throw err;
      }
      // Another concurrent request already drove us through logout; fail fast.
      if (loggedOut) {
        throw err;
      }
      // Out of attempts → sign out and surface the original error; the root
      // layout's useSession() handles the redirect. This cap is checked BEFORE
      // the recheck so it also bounds the pathological case where recheckSession
      // keeps reporting the session valid but the request still 401s (a stale/
      // rotated local cookie the recheck can't reconcile) — without it that path
      // re-issues forever and the caller's promise never settles.
      if (attempt >= MAX_AUTH_RETRIES) {
        if (!loggedOut) {
          loggedOut = true;
          // Logout is best-effort: even if clearing the session throws, we must
          // still surface the original ApiError, and useSession() reacts anyway.
          // Clearing the local cookie also forces a clean re-login, which is the
          // only recovery when the stored cookie is desynced from the server.
          try {
            await signOut();
          } catch {
            // ignore — fall through to throw the original error
          }
        }
        throw err;
      }
      // Re-check the session (single-flight). A valid session means the cookie
      // refreshed — clear the latch and retry the original request right away;
      // otherwise back off before retrying. Either way the cap above eventually
      // ends the loop.
      const valid = await recheckSession();
      if (valid) {
        loggedOut = false;
        continue;
      }
      await delay(authBackoff(attempt));
    }
  }
}

// Result of an `authClient.$fetch` call (it returns `{ data, error }` rather than
// throwing). The error object carries the HTTP `status`/`statusText` merged with the
// parsed JSON error body — so the server's `{ "error": "unauthorized" }` surfaces as
// `error.error`.
type FetchResult<T> = {
  data: T | null;
  error:
    | null
    | { status?: number; statusText?: string; message?: string; error?: unknown };
};

// Map a `$fetch` result into the same contract the raw-fetch helpers used to expose:
// return the parsed body, or throw an `ApiError` carrying the HTTP `status` + a message
// (callers depend on `.status` — e.g. outbox's 4xx-permanent check, composer's
// `instanceof ApiError`). A result with NO HTTP status is a transport-level failure
// (the request never completed) — throw a plain `Error` (status undefined) so
// `runWithAuthRetry`'s toxic-cookie/transport recovery path still engages.
function unwrap<T>(result: FetchResult<T>): T {
  if (result.error) {
    const status =
      typeof result.error.status === "number" && result.error.status >= 100
        ? result.error.status
        : undefined;
    const message =
      (typeof result.error.error === "string" && result.error.error) ||
      result.error.message ||
      result.error.statusText ||
      `request failed (${status ?? "network"})`;
    if (status === undefined) throw new Error(message);
    throw new ApiError(status, result.error, message);
  }
  // better-fetch yields "" for an empty/204 body; normalize to null (the old behavior).
  return (result.data === "" ? null : result.data) as T;
}

function toUrl(path: string): string {
  return path.startsWith("http") ? path : `${authBaseURL}${path}`;
}

// Cover images are stored as server-relative paths (e.g. `/sight/<batch>/x.jpg`
// or `/social/...`). The browser resolves those against its origin, but a
// native client has no origin, so we must prefix the API host. Remote URLs
// (Instagram CDN, etc.) and absolute URLs pass through unchanged.
export function resolveMediaUrl(
  src: string | null | undefined
): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("/")) return `${authBaseURL}${src}`;
  return src;
}

// All app API calls route through `authClient.$fetch` so the @better-auth/expo plugin's
// fetch hooks apply uniformly: they set `credentials: "omit"` and attach the stored
// session cookie via `getCookie()` (so React Native's shared NSURLSession cookie jar can
// never inject a STALE cookie and 401 us — the bug a raw `fetch` had), and persist any
// rotated `Set-Cookie`. This is the same path `useSession`/`getSession`/`signOut` use, so
// the two can no longer disagree about auth.
export async function apiGet<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  return runWithAuthRetry(async () => {
    const result = (await authClient.$fetch(toUrl(path), {
      method: "GET",
      signal: init?.signal ?? undefined,
    })) as FetchResult<T>;
    return unwrap<T>(result);
  });
}

export async function apiPostJson<T>(
  path: string,
  body: Json,
  init?: RequestInit
): Promise<T> {
  return runWithAuthRetry(async () => {
    // `$fetch` JSON-stringifies an object body and sets Content-Type automatically.
    const result = (await authClient.$fetch(toUrl(path), {
      method: "POST",
      body,
      signal: init?.signal ?? undefined,
    })) as FetchResult<T>;
    return unwrap<T>(result);
  });
}

// Generic non-GET JSON request reusing the same `$fetch` + unwrap path as
// apiGet/apiPostJson. Used for PATCH/DELETE against the projects API. DELETE
// responses may be empty — unwrap normalizes an empty body to null.
export async function apiSend<T>(
  path: string,
  method: "PATCH" | "DELETE" | "PUT",
  body?: Json,
  init?: RequestInit
): Promise<T> {
  return runWithAuthRetry(async () => {
    const result = (await authClient.$fetch(toUrl(path), {
      method,
      body: body !== undefined ? body : undefined,
      signal: init?.signal ?? undefined,
    })) as FetchResult<T>;
    return unwrap<T>(result);
  });
}

export async function apiPatch<T>(
  path: string,
  body: Json,
  init?: RequestInit
): Promise<T> {
  return apiSend<T>(path, "PATCH", body, init);
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return apiSend<T>(path, "DELETE", undefined, init);
}

function parseUploadResult<T>(status: number, rawBody: string): T {
  const body = rawBody ? (JSON.parse(rawBody) as unknown) : null;
  if (status < 200 || status >= 300) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${status})`;
    throw new ApiError(status, body, message);
  }
  return body as T;
}

export type UploadFileOptions = {
  // Multipart field name the server reads the file from (e.g. "image").
  fieldName: string;
  // MIME type of the file; the server uses it to pick the stored extension.
  mimeType?: string;
  // Extra string form fields sent alongside the file (batchId, totalCount, …).
  parameters?: Record<string, string>;
};

// Uploads a single local file as multipart/form-data via expo-file-system's
// uploadAsync. This replaces the fragile fetch + RN FormData path: uploadAsync
// reliably sets the multipart boundary, streams large files (video/audio), and
// lets us attach the session cookie + metadata explicitly. The server's
// parseMultipartImage path reads `fieldName` + `parameters` form fields.
export async function uploadFile<T>(
  path: string,
  fileUri: string,
  { fieldName, mimeType, parameters }: UploadFileOptions
): Promise<T> {
  return runWithAuthRetry(async () => {
    // Rebuild headers each attempt so a refreshed cookie is picked up on retry.
    const headers: Record<string, string> = {};
    const cookie = authClient.getCookie();
    if (cookie) {
      headers.Cookie = cookie;
    }
    const result = await uploadAsync(toUrl(path), fileUri, {
      httpMethod: "POST",
      uploadType: FileSystemUploadType.MULTIPART,
      fieldName,
      mimeType,
      parameters,
      headers,
    });
    return parseUploadResult<T>(result.status, result.body);
  });
}
