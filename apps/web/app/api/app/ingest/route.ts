import { submitUrlIngest } from "../../../../lib/ingest/submit";
import { agreedOr403, getSessionOrNull } from "../../../../lib/session";

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
  console.log(`[app/ingest] [${level}] ${msg}${payload}`);
}

export async function POST(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    log("warn", "unauthorized");
    return jsonError(401, "unauthorized");
  }
  const denied = agreedOr403(session);
  if (denied) {
    log("warn", "terms-required");
    return denied;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    log("warn", "invalid-json");
    return jsonError(400, "invalid JSON body");
  }

  // Only honor a string projectId; ownership is still validated in submit.ts.
  // (Guards against a non-string value reaching the Prisma lookup.)
  const rawProjectId =
    raw && typeof raw === "object"
      ? (raw as { projectId?: unknown }).projectId
      : null;
  const projectId =
    typeof rawProjectId === "string" && rawProjectId.length > 0
      ? rawProjectId
      : null;
  const result = await submitUrlIngest(raw, log, session.user.id, projectId);
  if (!result.ok) {
    return jsonError(result.status, result.error, result.extra);
  }
  return Response.json(result.body, { status: result.status });
}
