import { authBaseURL, authClient } from "./auth-client";

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

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const cookie = authClient.getCookie();
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new ApiError(res.status, body, message);
  }
  return body as T;
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

export async function apiGet<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(toUrl(path), {
    ...init,
    method: "GET",
    headers: buildHeaders(init?.headers),
  });
  return parseResponse<T>(res);
}

export async function apiPostJson<T>(
  path: string,
  body: Json,
  init?: RequestInit
): Promise<T> {
  const headers = buildHeaders(init?.headers);
  headers.set("Content-Type", "application/json");
  const res = await fetch(toUrl(path), {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

export async function apiPostForm<T>(
  path: string,
  form: FormData,
  init?: RequestInit
): Promise<T> {
  // Do NOT set Content-Type — React Native sets the multipart boundary itself.
  const res = await fetch(toUrl(path), {
    ...init,
    method: "POST",
    headers: buildHeaders(init?.headers),
    body: form as unknown as BodyInit,
  });
  return parseResponse<T>(res);
}
