import { listVisibleToViewer, type PostType } from "@repo/db";
import { PUBLIC_CATALOG_ENABLED } from "../../../../lib/features";
import { getViewerFriendIds } from "../../../../lib/friends-access";
import { getSessionOrNull } from "../../../../lib/session";

// GET: the "Friends" browsing feed — published posts a signed-in viewer may see
// beyond their own cockpit: their own + friends' FRIENDS posts + (when enabled)
// PUBLIC posts. Distinct from /api/app/posts (owner-only). Read access is
// enforced in the query (listVisibleToViewer), not just filtered client-side.
const VALID_TYPES: ReadonlySet<PostType> = new Set<PostType>([
  "CONCRETE",
  "BLOG",
  "FINDING",
  "SIGHT",
  "SOCIAL",
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
  const tags = url.searchParams.getAll("tag");
  const category = url.searchParams.get("category") ?? undefined;
  const typeParams = url.searchParams.getAll("type");
  const type = typeParams.length
    ? (typeParams.filter((t): t is PostType =>
        VALID_TYPES.has(t as PostType),
      ) as PostType[])
    : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const friendIds = await getViewerFriendIds(session.user.id);
  const page = await listVisibleToViewer({
    viewerId: session.user.id,
    friendIds,
    includePublic: PUBLIC_CATALOG_ENABLED,
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
    q,
    type: type && type.length > 0 ? type : undefined,
    tags: tags.length > 0 ? tags : undefined,
    category,
  });
  return Response.json(page);
}
