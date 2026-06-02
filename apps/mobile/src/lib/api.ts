import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

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
}
