// Request validators for the share-group APIs (session-authed; the actor is
// always session.user.id, never trusted from the body).
import { z } from "zod";

const GROUP_PRIVACY = ["PRIVATE", "NAMED"] as const;

export const groupCreateSchema = z.object({
  name: z.string().trim().min(1, "name required").max(80),
  visibility: z.enum(GROUP_PRIVACY).optional(),
  // Optional seed members (friend user ids). Non-friends are dropped server-side.
  memberIds: z.array(z.string().min(1)).max(500).optional(),
});

export const groupUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    visibility: z.enum(GROUP_PRIVACY).optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.visibility !== undefined,
    "empty patch",
  );

export const memberSchema = z.object({ userId: z.string().min(1) });

export const postGroupsSchema = z.object({
  // At least one group: a GROUP post with zero links is owner-only, an
  // audience-narrowing trap. Callers that want to STOP group-sharing must use the
  // visibility endpoint (PUT .../visibility) to move to a base tier instead.
  groupIds: z.array(z.string().min(1)).min(1).max(100),
});

export type GroupCreateInput = z.infer<typeof groupCreateSchema>;
export type GroupUpdateInput = z.infer<typeof groupUpdateSchema>;
