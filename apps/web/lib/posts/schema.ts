// Request validator for the per-post visibility endpoint. The literal union
// matches the PostVisibility enum values; setPostVisibility() enforces ownership.
import { z } from "zod";

export const visibilitySchema = z.object({
  visibility: z.enum(["PRIVATE", "FRIENDS", "PUBLIC"]),
});

export type VisibilityInput = z.infer<typeof visibilitySchema>;

// Request validator for the owner post-body editor (PATCH /api/app/posts/[slug]).
// All fields optional; at least one must be present. `status` only accepts
// PUBLISHED (the DRAFT->PUBLISHED publish action); updatePostContent enforces
// that the transition is legal. `expectedUpdatedAt` is an optional ISO string
// the client loaded — reserved for a future optimistic-concurrency check (412);
// today the editor is last-write-wins.
export const updatePostSchema = z
  .object({
    content: z.string().max(100_000).optional(),
    title: z.string().min(1).max(200).optional(),
    excerpt: z.string().max(500).nullable().optional(),
    status: z.literal("PUBLISHED").optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .refine(
    (v) =>
      v.content !== undefined ||
      v.title !== undefined ||
      v.excerpt !== undefined ||
      v.status !== undefined,
    { message: "at least one field is required" },
  );

export type UpdatePostInput = z.infer<typeof updatePostSchema>;
