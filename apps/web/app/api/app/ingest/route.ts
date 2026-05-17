import { submitUrlIngest } from "../../../../lib/ingest/submit";
import { getSessionOrNull } from "../../../../lib/session";

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
  console.log(`[app/ingest] [${level}] ${msg}${payload}`);
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    log("warn", "unauthorized");
    return jsonError(401, "unauthorized");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    log("warn", "invalid-json");
    return jsonError(400, "invalid JSON body");
  }

  const result = await submitUrlIngest(raw, log);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.extra);
  }
  return Response.json(result.body, { status: result.status });
}
