// Request validators for the friends endpoints. The DB helpers (packages/db/
// src/friends.ts) enforce direction/ownership, so these only shape the input.
import { z } from "zod";

// Send a friend request by the target's public handle (resolved to an id at the
// route boundary via findUserByHandle).
export const friendRequestSchema = z.object({
  handle: z.string().trim().min(1, "handle required").max(40),
});

// Act on an incoming pending request.
export const friendActionSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export type FriendRequestInput = z.infer<typeof friendRequestSchema>;
export type FriendActionInput = z.infer<typeof friendActionSchema>;
