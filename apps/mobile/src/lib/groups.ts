// Share groups: named, reusable audiences of the owner's friends, used as a 4th
// post audience (visibility = GROUP). This module is the SINGLE data + types layer
// every consumer (the audience sheet, the composer summary row, the Friends
// groups-manager, the group editor) shares — so no call site re-spells an endpoint
// or re-derives the audience-description text. NO JSX here.
//
// Online-only, exactly like per-post visibility: groups are never written to the
// offline mirror. The hooks below are react-query wrappers; the mutation helpers
// are thin endpoint shims that throw ApiError on failure (callers surface the
// message inline).
import { useQuery } from "@tanstack/react-query";

import { apiGet, apiPostJson, apiSend } from "@/lib/api";
import type { Visibility } from "@/lib/ingest-submit";

// Group privacy is BINARY (mirrors the server ShareGroupVisibility enum):
//   PRIVATE — only the owner sees the group's name + roster (the default).
//   NAMED   — members may see the group name + co-members.
// Labeled "Private" / "Shared" in the mobile UI.
export type GroupPrivacy = "PRIVATE" | "NAMED";

// A current accepted friend (the GET /api/app/friends row). `image` is the
// avatar path (server-relative or remote); optional for rows that omit it.
export type Friend = {
  id: string;
  name: string;
  handle: string | null;
  image?: string | null;
};

// A group member (GET /api/app/groups/[id] → members[]).
export type GroupMember = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

// A group as returned by GET /api/app/groups (list, no members) and, when fetched
// by id, GET /api/app/groups/[id] (detail, with members). `members` is therefore
// optional — present only on the detail read. Dates arrive as ISO strings.
export type Group = {
  id: string;
  name: string;
  visibility: GroupPrivacy;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  members?: GroupMember[];
};

// The detail shape (GET /api/app/groups/[id]) always carries members.
export type GroupDetail = Group & { members: GroupMember[] };

// The full read-audience union (shared with the ingest layer). A post is shared
// with friends, the public, only the owner, or specific share groups.
export type Audience = Visibility;

// The composer/post-editor audience choice. Invariant (enforced by the UI):
// groupIds is non-empty IFF visibility === "GROUP".
export type AudienceValue = {
  visibility: Visibility;
  groupIds: string[];
};

export const DEFAULT_AUDIENCE: AudienceValue = {
  visibility: "PRIVATE",
  groupIds: [],
};

// --- hooks ----------------------------------------------------------------

// The signed-in user's groups. Shared by every consumer via the ["groups"] key so
// a create/delete invalidation refreshes them all at once.
export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => apiGet<{ groups: Group[] }>("/api/app/groups"),
  });
}

// The signed-in user's accepted friends. Same ["friends"] key the Friends screen
// uses, so the cache is shared (a friend added there shows up here immediately).
export function useFriends() {
  return useQuery({
    queryKey: ["friends"],
    queryFn: () => apiGet<{ friends: Friend[] }>("/api/app/friends"),
  });
}

// --- mutation helpers (so call sites never re-spell endpoints) -------------

export function createGroup(input: {
  name: string;
  visibility?: GroupPrivacy;
  memberIds?: string[];
}): Promise<{ ok: true; id: string }> {
  return apiPostJson<{ ok: true; id: string }>("/api/app/groups", {
    name: input.name,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.memberIds?.length ? { memberIds: input.memberIds } : {}),
  });
}

export function patchGroup(
  id: string,
  input: { name?: string; visibility?: GroupPrivacy },
): Promise<{ ok: true }> {
  return apiSend<{ ok: true }>(`/api/app/groups/${id}`, "PATCH", input);
}

export function deleteGroup(
  id: string,
): Promise<{ ok: true; deleted: true }> {
  return apiSend<{ ok: true; deleted: true }>(`/api/app/groups/${id}`, "DELETE");
}

export function addGroupMember(
  id: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiPostJson<{ ok: true }>(`/api/app/groups/${id}/members`, { userId });
}

export function removeGroupMember(
  id: string,
  userId: string,
): Promise<{ ok: true }> {
  return apiSend<{ ok: true }>(
    `/api/app/groups/${id}/members/${userId}`,
    "DELETE",
  );
}

// Replace the set of share groups a post is shared with. The server flips
// visibility=GROUP AND replaces the groups in one transaction (so this is the
// only call needed when saving a GROUP audience).
export function setPostGroups(
  slug: string,
  groupIds: string[],
): Promise<{ ok: true; groupIds: string[] }> {
  return apiSend<{ ok: true; groupIds: string[] }>(
    `/api/app/posts/${slug}/groups`,
    "PUT",
    { groupIds },
  );
}

// Set a post's base read tier (PRIVATE | FRIENDS | PUBLIC). Used to STOP
// group-sharing — the server's group-set endpoint always implies GROUP, so
// clearing groups falls back through here.
export function setPostBaseVisibility(
  slug: string,
  visibility: "PRIVATE" | "FRIENDS" | "PUBLIC",
): Promise<{ ok: true; visibility: string }> {
  return apiSend<{ ok: true; visibility: string }>(
    `/api/app/posts/${slug}/visibility`,
    "PUT",
    { visibility },
  );
}

// --- pure description helpers ---------------------------------------------

// A short, human summary of an audience value for a compact summary row (the
// composer "Audience" row, a list cell). `groups` is the ["groups"] list so a
// GROUP audience can name the chosen group(s).
export function describeAudience(
  value: AudienceValue,
  groups: Group[],
): string {
  switch (value.visibility) {
    case "PRIVATE":
      return "Only you";
    case "FRIENDS":
      return "Friends";
    case "PUBLIC":
      return "Public";
    case "GROUP": {
      const names = value.groupIds
        .map((id) => groups.find((g) => g.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      if (names.length === 0) return "Groups";
      if (names.length === 1) return names[0]!;
      return `${names.length} groups`;
    }
  }
}

// The one-line explanatory hint shown under the audience picker.
export function audienceHint(v: Visibility): string {
  switch (v) {
    case "PRIVATE":
      return "Only you can see this.";
    case "FRIENDS":
      return "Everyone you've added as a friend.";
    case "PUBLIC":
      return "Anyone signed in can find this.";
    case "GROUP":
      return "Only the groups you choose below.";
  }
}

// The mobile label for a group's privacy tier.
export function privacyLabel(v: GroupPrivacy): string {
  return v === "NAMED" ? "Shared" : "Private";
}
