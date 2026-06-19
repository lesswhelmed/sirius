import { verifyBearer } from "../../../lib/ingest/auth";
import {
  parseMultipartFile,
  parseRawFile,
  submitFileIngest,
} from "../../../lib/ingest/submit";

function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
) {
  return Response.json({ error, ...extra }, { status });
}

function log(
  level: "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[ingest-file] [${level}] ${msg}${payload}`);
}

export async function POST(request: Request) {
  const auth = verifyBearer(request);
  if (!auth.ok) {
    log("warn", "unauthorized", { reason: auth.reason });
    return jsonError(401, "unauthorized", { reason: auth.reason });
  }

  const contentType = request.headers.get("content-type") ?? "";
  const parsed = contentType.toLowerCase().includes("multipart/form-data")
    ? await parseMultipartFile(request)
    : await parseRawFile(request);

  if ("error" in parsed) {
    log("warn", "parse-failed", { reason: parsed.error, contentType });
    return jsonError(400, parsed.error, { contentType });
  }

  // Bearer path has no submitter, so projectId is intentionally omitted here
  // (matching the existing bearer ingest/ingest-images behavior).
  const result = await submitFileIngest(parsed, log);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.extra);
  }
  return Response.json(result.body, { status: result.status });
}
