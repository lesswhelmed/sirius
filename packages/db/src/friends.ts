// Friendship lifecycle + the per-post sharing primitive. Writes AND reads for the
// social graph live here (posts.ts stays query-only by contract; saved.ts is the
// model to follow). Callers always pass the trusted session user id as the actor;
// every mutation guards ownership/role inside its where-clause so a forged target
// can never escalate.
import {
  FriendshipStatus,
  PostVisibility,
  Prisma,
} from "../generated/prisma";
import { prisma } from "./index";

const UNIQUE_VIOLATION = "P2002";

// Canonical pair ordering — the ONE place that decides (userAId, userBId). Every
// read/write routes through this so the @@unique([userAId, userBId]) guard is a
// real dedup constraint (no A→B + B→A pair can exist).
function orderPair(x: string, y: string): { userAId: string; userBId: string } {
  return x < y ? { userAId: x, userBId: y } : { userAId: y, userBId: x };
}

// --- the read primitives --------------------------------------------------

// Are two users accepted friends? A single unique-key lookup regardless of who
// originally sent the request. Self is never "friends".
export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const pair = orderPair(a, b);
  const row = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
    select: { status: true },
  });
  return row?.status === FriendshipStatus.ACCEPTED;
}

// "May this viewer read this post by virtue of SHARING (not ownership)?" An
// accepted friend may read a PUBLISHED post whose visibility is FRIENDS OR
// PUBLIC. PUBLIC-for-friends is intentional and flag-INDEPENDENT: two friends
// always see each other's PUBLIC posts regardless of PUBLIC_CATALOG_ENABLED.
// That flag still gates stranger/anonymous PUBLIC reads — but only in
// canReadPost's tier 3 (the separate PUBLIC branch), never here. status is
// included so a draft marked FRIENDS/PUBLIC is never exposed (sharing implies
// published-only). PRIVATE is never shared through this primitive.
export async function isPostSharedWith(
  post: { submittedById: string | null; visibility: PostVisibility; status: string },
  viewerId: string | null,
): Promise<boolean> {
  if (viewerId == null || post.submittedById == null) return false;
  if (
    post.visibility !== PostVisibility.FRIENDS &&
    post.visibility !== PostVisibility.PUBLIC
  ) {
    return false;
  }
  // Sharing implies published-only: a draft/archived FRIENDS/PUBLIC post stays
  // private.
  if (post.status !== "PUBLISHED") return false;
  return areFriends(post.submittedById, viewerId);
}

// The set of userIds whose FRIENDS posts this viewer may see. Used to widen list
// queries (posts.visibilityWhereForViewer). Wrap per-request at the call site
// (React cache()) so a page checking many posts does one round-trip.
export async function friendIdsOf(viewerId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [{ userAId: viewerId }, { userBId: viewerId }],
    },
    select: { userAId: true, userBId: true },
  });
  return rows.map((r) => (r.userAId === viewerId ? r.userBId : r.userAId));
}

// --- friend-request lifecycle (writes) ------------------------------------

export type FriendRequestResult =
  | { ok: true; status: FriendshipStatus }
  | { ok: false; reason: "self" | "already" | "blocked" };

// Send (or re-arm) a friend request. requesterId is the trusted actor.
export async function sendFriendRequest(
  requesterId: string,
  targetId: string,
): Promise<FriendRequestResult> {
  if (requesterId === targetId) return { ok: false, reason: "self" };
  const pair = orderPair(requesterId, targetId);
  try {
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
      select: { status: true },
    });
    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        return { ok: false, reason: "already" };
      }
      if (existing.status === FriendshipStatus.BLOCKED) {
        return { ok: false, reason: "blocked" };
      }
      if (existing.status === FriendshipStatus.PENDING) {
        return { ok: false, reason: "already" };
      }
      // DECLINED → allow one fresh request, flipping direction to this requester.
      await prisma.friendship.update({
        where: { userAId_userBId: pair },
        data: { status: FriendshipStatus.PENDING, requestedById: requesterId },
      });
      return { ok: true, status: FriendshipStatus.PENDING };
    }
    await prisma.friendship.create({
      data: { ...pair, status: FriendshipStatus.PENDING, requestedById: requesterId },
    });
    return { ok: true, status: FriendshipStatus.PENDING };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      // Race: another request for the same pair landed first.
      return { ok: false, reason: "already" };
    }
    throw error;
  }
}

// Accept a pending request. ONLY the recipient (not requestedById) may accept;
// the guard lives in the where so a non-recipient matches zero rows.
export async function acceptFriendRequest(
  accepterId: string,
  otherId: string,
): Promise<boolean> {
  const pair = orderPair(accepterId, otherId);
  const res = await prisma.friendship.updateMany({
    where: {
      ...pair,
      status: FriendshipStatus.PENDING,
      requestedById: { not: accepterId },
    },
    data: { status: FriendshipStatus.ACCEPTED, acceptedAt: new Date() },
  });
  return res.count > 0;
}

// Decline a pending request (recipient only). Row is kept as DECLINED (not
// deleted) to throttle re-spam; sendFriendRequest allows one re-arm.
export async function declineFriendRequest(
  declinerId: string,
  otherId: string,
): Promise<boolean> {
  const pair = orderPair(declinerId, otherId);
  const res = await prisma.friendship.updateMany({
    where: {
      ...pair,
      status: FriendshipStatus.PENDING,
      requestedById: { not: declinerId },
    },
    data: { status: FriendshipStatus.DECLINED },
  });
  return res.count > 0;
}

// Remove an accepted friend (either party) OR cancel one's own outgoing request.
// Hard-deletes so a future re-request starts clean. Idempotent.
export async function removeFriend(
  userId: string,
  otherId: string,
): Promise<boolean> {
  const pair = orderPair(userId, otherId);
  // Cascade: when the friendship ends, each person leaves the OTHER's share
  // groups (both directions). Membership requires a live friendship, so a removed
  // friend must immediately lose group-shared reads. The purge runs
  // unconditionally with the delete in one transaction — it's a harmless no-op
  // when no memberships exist (e.g. cancelling an outgoing request). The live
  // areFriends() check in isPostSharedWithViaGroup is the second line of defense
  // for any in-flight read.
  const [res] = await prisma.$transaction([
    prisma.friendship.deleteMany({
      where: {
        ...pair,
        OR: [
          { status: FriendshipStatus.ACCEPTED },
          { status: FriendshipStatus.PENDING, requestedById: userId },
        ],
      },
    }),
    prisma.shareGroupMember.deleteMany({
      where: {
        OR: [
          { userId: otherId, group: { ownerId: userId } },
          { userId: userId, group: { ownerId: otherId } },
        ],
      },
    }),
  ]);
  return res.count > 0;
}

// --- lists ----------------------------------------------------------------

export type FriendSummary = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
  friendsSince: Date | null;
};

type FriendRow = {
  userAId: string;
  userBId: string;
  acceptedAt: Date | null;
  userA: { id: string; name: string; handle: string | null; image: string | null };
  userB: { id: string; name: string; handle: string | null; image: string | null };
};

const PEER_SELECT = {
  select: { id: true, name: true, handle: true, image: true },
} as const;

function peerOf(row: FriendRow, viewerId: string) {
  return row.userAId === viewerId ? row.userB : row.userA;
}

export async function listFriends(userId: string): Promise<FriendSummary[]> {
  const rows = (await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.ACCEPTED,
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    orderBy: { acceptedAt: "desc" },
    include: { userA: PEER_SELECT, userB: PEER_SELECT },
  })) as FriendRow[];
  return rows.map((r) => {
    const peer = peerOf(r, userId);
    return {
      id: peer.id,
      name: peer.name,
      handle: peer.handle,
      image: peer.image,
      friendsSince: r.acceptedAt,
    };
  });
}

export type PendingRequest = {
  user: Omit<FriendSummary, "friendsSince">;
  direction: "incoming" | "outgoing";
  createdAt: Date;
};

export async function listPendingRequests(
  userId: string,
): Promise<PendingRequest[]> {
  const rows = (await prisma.friendship.findMany({
    where: {
      status: FriendshipStatus.PENDING,
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    orderBy: { createdAt: "desc" },
    include: { userA: PEER_SELECT, userB: PEER_SELECT },
  })) as (FriendRow & { requestedById: string; createdAt: Date })[];
  return rows.map((r) => {
    const peer = peerOf(r, userId);
    return {
      user: { id: peer.id, name: peer.name, handle: peer.handle, image: peer.image },
      direction: r.requestedById === userId ? "outgoing" : "incoming",
      createdAt: r.createdAt,
    };
  });
}

// The viewer's friendship state toward another user, for the profile add-friend
// button. "self" when ids match.
export type FriendshipState =
  | "self"
  | "none"
  | "outgoing"
  | "incoming"
  | "friends";

export async function friendshipState(
  viewerId: string,
  otherId: string,
): Promise<FriendshipState> {
  if (viewerId === otherId) return "self";
  const pair = orderPair(viewerId, otherId);
  const row = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
    select: { status: true, requestedById: true },
  });
  if (!row) return "none";
  if (row.status === FriendshipStatus.ACCEPTED) return "friends";
  if (row.status === FriendshipStatus.PENDING) {
    return row.requestedById === viewerId ? "outgoing" : "incoming";
  }
  return "none"; // DECLINED / BLOCKED present as "none" to the requester UI
}

// --- per-post visibility (owner-only write) -------------------------------

// Set a post's visibility. Owner guard is inside the updateMany.where, so a
// non-owner matches zero rows → returns false. updatedAt bumps automatically,
// so the change rides the owner's existing offline-mirror delta feed.
export async function setPostVisibility(
  ownerId: string,
  postId: string,
  visibility: PostVisibility,
): Promise<boolean> {
  const res = await prisma.post.updateMany({
    where: { id: postId, submittedById: ownerId },
    data: { visibility },
  });
  return res.count > 0;
}
