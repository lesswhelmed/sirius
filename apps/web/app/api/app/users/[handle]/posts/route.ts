import {
  areFriends,
  findUserByHandle,
  listFriendCatalog,
  type PostType,
} from "@repo/db";
import { getSessionOrNull } from "../../../../../../lib/session";

// GET: one friend's catalog — the PUBLISHED posts of the user at <handle> whose
// visibility is FRIENDS or PUBLIC (PRIVATE never appears). Friends always see
// each other's PUBLIC + FRIENDS posts regardless of PUBLIC_CATALOG_ENABLED (that
// flag only gates non-friend/anonymous PUBLIC access — see isPostSharedWith).
//
// Lives under /api/app/users/[handle] (NOT /api/app/friends) because the friends
// namespace already owns a [userId] dynamic segment, and Next.js forbids two
// different slug names at the same path position. Resolution here is by handle,
// so a users/[handle] home is the natural, collision-free fit.
//
// 404 (not 403) when the handle resolves to nobody OR the viewer isn't an
// accepted friend, so the endpoint never reveals whether a user/friendship
// exists (matches the repo's 404-not-403 convention; see
// /api/app/posts/[slug]/route.ts).
const VALID_TYPES: ReadonlySet<PostType> = new Set<PostType>([
  "CONCRETE",
  "BLOG",
  "FINDING",
  "SIGHT",
  "SOCIAL",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const session = await getSessionOrNull();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { handle } = await params;
  const user = await findUserByHandle(handle);
  // Hide existence: unknown handle OR not-an-accepted-friend both 404. The
  // viewer's own handle is treated as not-found here too — this endpoint is for
  // browsing OTHERS' catalogs (areFriends() returns false for self).
  if (!user || !(await areFriends(session.user.id, user.id))) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const tags = url.searchParams.getAll("tag");
  const typeParams = url.searchParams.getAll("type");
  const type = typeParams.length
    ? (typeParams.filter((t): t is PostType =>
        VALID_TYPES.has(t as PostType),
      ) as PostType[])
    : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const page = await listFriendCatalog({
    friendId: user.id,
    limit: Number.isFinite(limit) ? limit : undefined,
    cursor,
    q,
    type: type && type.length > 0 ? type : undefined,
    tags: tags.length > 0 ? tags : undefined,
  });

  return Response.json({
    user: {
      id: user.id,
      name: user.name,
      handle: user.handle,
      image: user.image,
    },
    items: page.items,
    nextCursor: page.nextCursor,
  });
}
