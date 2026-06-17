import { listSubmissions, type IngestStatus } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

const VALID_STATUSES: ReadonlySet<IngestStatus> = new Set<IngestStatus>([
  "pending",
  "processing",
  "completed",
  "failed",
  "skipped",
]);

export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const statusParams = url.searchParams.getAll("status");

  const status = statusParams.length
    ? (statusParams.filter((s): s is IngestStatus =>
        VALID_STATUSES.has(s as IngestStatus)
      ) as IngestStatus[])
    : undefined;

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const page = await listSubmissions(session.user.id, {
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
    status: status && status.length > 0 ? status : undefined,
  });

  return Response.json(page);
}
