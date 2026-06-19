import { z } from "zod";

// Body of a new comment. Trimmed, non-empty, capped so a runaway paste can't
// bloat a row. Matches the mobile composer's client-side guard.
export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, "comment required").max(5000),
});

export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
