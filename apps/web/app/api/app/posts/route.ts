import { listPosts, PostStatus, PostType } from "@repo/db";
import { getSessionOrNull } from "../../../../lib/session";

const VALID_TYPES: ReadonlySet<PostType> = new Set<PostType>([
  "CONCRETE",
  "BLOG",
  "FINDING",
  "SIGHT",
  "SOCIAL",
]);

const VALID_STATUSES: ReadonlySet<PostStatus> = new Set<PostStatus>([
  "PUBLISHED",
  "DRAFT",
  "ARCHIVED",
]);

export async function GET(request: Request) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const typeParams = url.searchParams.getAll("type");
  const statusParams = url.searchParams.getAll("status");

  const type = typeParams.length
    ? (typeParams.filter((t): t is PostType =>
        VALID_TYPES.has(t as PostType)
      ) as PostType[])
    : undefined;

  const status = statusParams.length
    ? (statusParams.filter((s): s is PostStatus =>
        VALID_STATUSES.has(s as PostStatus)
      ) as PostStatus[])
    : undefined;

  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const page = await listPosts({
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
    type: type && type.length > 0 ? type : undefined,
    status: status && status.length > 0 ? status : undefined,
    q,
  });

  return Response.json(page);
}
