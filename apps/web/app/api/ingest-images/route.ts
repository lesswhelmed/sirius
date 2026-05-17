import { verifyBearer } from "../../../lib/ingest/auth";
import {
  parseMultipartImage,
  parseRawImage,
  submitImageIngest,
} from "../../../lib/ingest/submit";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
) {
  return Response.json({ error, ...extra }, { status });
}

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>
) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[ingest-images] [${level}] ${msg}${payload}`);
}

function logRequestShape(
  request: Request,
  reason: string,
  extra?: Record<string, unknown>
) {
  const headerKeys: string[] = [];
  request.headers.forEach((_value, key) => {
    headerKeys.push(key);
  });
  const url = new URL(request.url);
  const queryKeys = [...url.searchParams.keys()];
  console.log(
    "[ingest-images] 400",
    JSON.stringify({
      reason,
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      headerKeys,
      queryKeys,
      xBatchId: request.headers.get("x-batchid"),
      xImageIndex: request.headers.get("x-imageindex"),
      xTotalCount: request.headers.get("x-totalcount"),
      xNotes: request.headers.get("x-notes"),
      ...(extra ?? {}),
    })
  );
}

export async function POST(request: Request) {
  const auth = verifyBearer(request);
  if (!auth.ok) {
    log("warn", "unauthorized", { reason: auth.reason });
    return jsonError(401, "unauthorized", { reason: auth.reason });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const parsed = contentType.toLowerCase().includes("multipart/form-data")
    ? await parseMultipartImage(request)
    : await parseRawImage(request);

  if ("error" in parsed) {
    logRequestShape(request, parsed.error);
    return jsonError(400, parsed.error, { contentType });
  }

  const result = await submitImageIngest(parsed, log);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.extra);
  }
  return Response.json(result.body, { status: result.status });
}
