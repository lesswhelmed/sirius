// Share groups: named, reusable audiences of the owner's friends, used as a 4th
// post audience (Post.visibility = GROUP + PostShareGroup rows). Writes AND the
// group read-primitive live here (posts.ts stays query-only; friends.ts is the
// model to follow). Callers always pass the trusted session user id as the actor;
// every mutation guards ownership inside its where-clause so a forged target can
// never escalate. Membership targets must be the owner's CURRENT accepted friends.
import {
  PostStatus,
  PostVisibility,
  Prisma,
  ShareGroupVisibility,
} from "../generated/prisma";
import { areFriends, friendIdsOf } from "./friends";
import { prisma } from "./index";

const UNIQUE_VIOLATION = "P2002";

// Guardrail: a group can't grow unbounded. Adds beyond this are rejected.
export const MAX_GROUP_MEMBERS = 500;

const PEER_SELECT = {
  select: { id: true, name: true, handle: true, image: true },
} as const;

export type GroupMember = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

export type ShareGroupSummary = {
  id: string;
  name: string;
  visibility: ShareGroupVisibility;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ShareGroupDetail = ShareGroupSummary & {
  members: GroupMember[];
};

// --- group CRUD -----------------------------------------------------------

export type CreateGroupResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate-name" };

// Create a group owned by ownerId. Optionally seed members (each validated as a
// current accepted friend; non-friends are silently dropped). The (ownerId,name)
// unique constraint surfaces as duplicate-name.
export async function createShareGroup(input: {
  ownerId: string;
  name: string;
  visibility?: ShareGroupVisibility;
  memberIds?: string[];
}): Promise<CreateGroupResult> {
  const name = input.name.trim();
  try {
    const group = await prisma.shareGroup.create({
      data: {
        ownerId: input.ownerId,
        name,
        visibility: input.visibility ?? ShareGroupVisibility.PRIVATE,
      },
      select: { id: true },
    });
    if (input.memberIds && input.memberIds.length > 0) {
      const owned = await friendsAmong(input.ownerId, input.memberIds);
      if (owned.length > 0) {
        await prisma.shareGroupMember.createMany({
          data: owned
            .slice(0, MAX_GROUP_MEMBERS)
            .map((userId) => ({ groupId: group.id, userId })),
          skipDuplicates: true,
        });
      }
    }
    return { ok: true, id: group.id };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return { ok: false, reason: "duplicate-name" };
    }
    throw error;
  }
}

export type UpdateGroupResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "duplicate-name" };

// Rename / re-scope a group (owner only). The owner guard is inside the where so
// a non-owner matches zero rows → not-found.
export async function updateShareGroup(
  ownerId: string,
  id: string,
  patch: { name?: string; visibility?: ShareGroupVisibility },
): Promise<UpdateGroupResult> {
  const data: Prisma.ShareGroupUpdateManyMutationInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (Object.keys(data).length === 0) return { ok: true };
  try {
    const res = await prisma.shareGroup.updateMany({
      where: { id, ownerId },
      data,
    });
    return res.count > 0 ? { ok: true } : { ok: false, reason: "not-found" };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      return { ok: false, reason: "duplicate-name" };
    }
    throw error;
  }
}

// Delete a group (owner only). ShareGroupMember + PostShareGroup cascade. A post
// left with zero links stays visibility=GROUP but is owner-only (safe). Idempotent.
export async function deleteShareGroup(
  ownerId: string,
  id: string,
): Promise<boolean> {
  const res = await prisma.shareGroup.deleteMany({ where: { id, ownerId } });
  return res.count > 0;
}

// --- membership -----------------------------------------------------------

export type AddMemberResult =
  | { ok: true }
  | { ok: false; reason: "group-not-found" | "not-friend" | "full" };

// Add memberId to the owner's group. Guards: group owned by owner; memberId is a
// CURRENT accepted friend; roster under cap. Idempotent (P2002 → ok).
export async function addGroupMember(
  ownerId: string,
  groupId: string,
  memberId: string,
): Promise<AddMemberResult> {
  const group = await prisma.shareGroup.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true },
  });
  if (!group) return { ok: false, reason: "group-not-found" };
  if (!(await areFriends(ownerId, memberId))) {
    return { ok: false, reason: "not-friend" };
  }
  const count = await prisma.shareGroupMember.count({ where: { groupId } });
  if (count >= MAX_GROUP_MEMBERS) return { ok: false, reason: "full" };
  try {
    await prisma.shareGroupMember.create({ data: { groupId, userId: memberId } });
  } catch (error) {
    if (
      !(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      )
    ) {
      throw error;
    }
    // Already a member — idempotent.
  }
  return { ok: true };
}

// Remove a member (owner only; the owner gate is the relation filter so a
// non-owner matches zero rows). Idempotent.
export async function removeGroupMember(
  ownerId: string,
  groupId: string,
  memberId: string,
): Promise<boolean> {
  const res = await prisma.shareGroupMember.deleteMany({
    where: { groupId, userId: memberId, group: { ownerId } },
  });
  return res.count > 0;
}

// --- lists ----------------------------------------------------------------

export async function listShareGroups(
  ownerId: string,
): Promise<ShareGroupSummary[]> {
  const rows = await prisma.shareGroup.findMany({
    where: { ownerId },
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    visibility: g.visibility,
    memberCount: g._count.members,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  }));
}

export async function getShareGroup(
  ownerId: string,
  id: string,
): Promise<ShareGroupDetail | null> {
  const group = await prisma.shareGroup.findFirst({
    where: { id, ownerId },
    include: { members: { include: { user: PEER_SELECT } } },
  });
  if (!group) return null;
  return {
    id: group.id,
    name: group.name,
    visibility: group.visibility,
    memberCount: group.members.length,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    members: group.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      handle: m.user.handle,
      image: m.user.image,
    })),
  };
}

// --- post <-> groups (owner-only) -----------------------------------------

export type SetPostGroupsResult =
  | { ok: true; groupIds: string[] }
  | { ok: false; reason: "post-not-found" | "invalid-group" };

// Replace the set of groups a post is shared with AND set visibility=GROUP, in
// one transaction. Owner-gated on the post; every groupId must be owned by
// ownerId. Passing [] sets visibility=GROUP with no links (owner-only) — callers
// that want to STOP group-sharing should use setPostVisibility instead.
export async function setPostShareGroups(
  ownerId: string,
  postId: string,
  groupIds: string[],
): Promise<SetPostGroupsResult> {
  const post = await prisma.post.findFirst({
    where: { id: postId, submittedById: ownerId },
    select: { id: true },
  });
  if (!post) return { ok: false, reason: "post-not-found" };

  const unique = [...new Set(groupIds)];
  if (unique.length > 0) {
    const owned = await prisma.shareGroup.count({
      where: { id: { in: unique }, ownerId },
    });
    if (owned !== unique.length) return { ok: false, reason: "invalid-group" };
  }

  await prisma.$transaction([
    prisma.post.update({
      where: { id: postId },
      data: { visibility: PostVisibility.GROUP },
    }),
    prisma.postShareGroup.deleteMany({ where: { postId } }),
    prisma.postShareGroup.createMany({
      data: unique.map((groupId) => ({ postId, groupId })),
      skipDuplicates: true,
    }),
  ]);
  return { ok: true, groupIds: unique };
}

// The owner's groups a post is shared with (owner-scoped — a recipient never
// enumerates a post's groups; that's the PRIVATE-by-default group identity).
export async function listPostShareGroups(
  ownerId: string,
  postId: string,
): Promise<ShareGroupSummary[]> {
  const rows = await prisma.shareGroup.findMany({
    where: { ownerId, postLinks: { some: { postId } } },
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { members: true } } },
  });
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    visibility: g.visibility,
    memberCount: g._count.members,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  }));
}

// --- read primitive (consumed by post-access.ts) --------------------------

// "May this viewer read this GROUP post by virtue of group membership?" Mirrors
// isPostSharedWith: published-only, requires a CURRENT membership row in a linked
// group AND a CURRENT friendship with the owner (defense in depth).
export async function isPostSharedWithViaGroup(
  post: {
    id: string;
    submittedById: string | null;
    visibility: PostVisibility;
    status: string;
  },
  viewerId: string | null,
): Promise<boolean> {
  if (viewerId == null || post.submittedById == null) return false;
  if (post.visibility !== PostVisibility.GROUP) return false;
  if (post.status !== PostStatus.PUBLISHED) return false;
  if (!(await areFriends(post.submittedById, viewerId))) return false;
  const link = await prisma.postShareGroup.findFirst({
    where: { postId: post.id, group: { members: { some: { userId: viewerId } } } },
    select: { id: true },
  });
  return link != null;
}

// --- validation helper (used by ingest submit.ts) -------------------------

// The subset of `ids` that are groups actually owned by ownerId.
export async function shareGroupIdsOwnedBy(
  ownerId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.shareGroup.findMany({
    where: { id: { in: [...new Set(ids)] }, ownerId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// The subset of `userIds` that are the owner's current accepted friends. Used to
// validate seed members on create. One round-trip (friendIdsOf) intersected with
// the requested set, instead of N parallel areFriends lookups.
async function friendsAmong(
  ownerId: string,
  userIds: string[],
): Promise<string[]> {
  const requested = new Set(userIds);
  const friendIds = await friendIdsOf(ownerId);
  return friendIds.filter((id) => requested.has(id));
}
