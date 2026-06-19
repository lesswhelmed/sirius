import {
  parseMultipartImage,
  parseRawImage,
  submitImageIngest,
} from "../../../../lib/ingest/submit";
import { getSessionOrNull } from "../../../../lib/session";

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
  console.log(`[app/ingest-images] [${level}] ${msg}${payload}`);
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    log("warn", "unauthorized");
    return jsonError(401, "unauthorized");
  }

  const contentType = request.headers.get("content-type") ?? "";
  const parsed = contentType.toLowerCase().includes("multipart/form-data")
    ? await parseMultipartImage(request)
    : await parseRawImage(request);

  if ("error" in parsed) {
    log("warn", "parse-failed", { reason: parsed.error, contentType });
    return jsonError(400, parsed.error, { contentType });
  }

  // metadata.projectId is schema-coerced to a string ("" when absent);
  // ownership is validated in submit.ts. Normalize empty → null.
  const projectId = parsed.metadata.projectId || null;
  const result = await submitImageIngest(
    parsed,
    log,
    session.user.id,
    projectId,
  );
  if (!result.ok) {
    return jsonError(result.status, result.error, result.extra);
  }
  return Response.json(result.body, { status: result.status });
}
