// Single source of truth for the share-groups audience model on the web client.
// Neutral (no "use client") so both server pages and client components import the
// same union. The backend contract is FROZEN: the post visibility union gained a
// 4th tier "GROUP", and a group's own privacy is a BINARY enum (PRIVATE | NAMED).

// A post's read audience. PRIVATE/FRIENDS/PUBLIC are the base tiers; GROUP means
// the post is shared with one or more of the owner's share groups (the active
// groupIds). Invariant enforced by the UI + server: groupIds is non-empty IFF
// visibility === "GROUP".
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC" | "GROUP";

// A group's OWN privacy (who can see the group's name + roster), NOT a post
// audience. PRIVATE = only the owner sees the group; NAMED = members may see the
// group name + co-members. Labelled Private / Named in the web UI.
export type GroupPrivacy = "PRIVATE" | "NAMED";

// A friend identity as it appears in a group roster or the create-group picker.
export type GroupMember = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

// A group as listed (no roster). createdAt/updatedAt arrive as ISO strings over
// the JSON API; the server pages serialize the @repo/db Date fields to match.
export type GroupSummary = {
  id: string;
  name: string;
  visibility: GroupPrivacy;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

// A single group with its roster (the GET /api/app/groups/[id] shape).
export type GroupDetail = GroupSummary & {
  members: GroupMember[];
};

// The one value the AudiencePicker reads/writes. Both modes (compose + edit)
// speak this shape.
export type AudienceValue = {
  visibility: Visibility;
  groupIds: string[];
};

// The default audience for a new post: PRIVATE, no groups.
export const DEFAULT_AUDIENCE: AudienceValue = {
  visibility: "PRIVATE",
  groupIds: [],
};

// The three base read-visibility tiers, in escalating-exposure order. GROUP is
// intentionally absent — it's expressed by selecting one or more group chips.
export const VISIBILITY_OPTIONS: {
  value: Exclude<Visibility, "GROUP">;
  label: string;
  hint: string;
}[] = [
  { value: "PRIVATE", label: "Private", hint: "Only you" },
  { value: "FRIENDS", label: "Friends", hint: "People you've added" },
  { value: "PUBLIC", label: "Public", hint: "Anyone signed in" },
];

// Privacy choices for the create/edit-group dialog (labelled Private / Named).
export const GROUP_PRIVACY_OPTIONS: {
  value: GroupPrivacy;
  label: string;
  hint: string;
}[] = [
  { value: "PRIVATE", label: "Private", hint: "Only you see this group" },
  { value: "NAMED", label: "Named", hint: "Members see the group + each other" },
];
