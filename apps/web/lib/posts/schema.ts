// Request validator for the per-post visibility endpoint. The literal union
// matches the PostVisibility enum values; setPostVisibility() enforces ownership.
import { z } from "zod";

export const visibilitySchema = z.object({
  visibility: z.enum(["PRIVATE", "FRIENDS", "PUBLIC"]),
});

export type VisibilityInput = z.infer<typeof visibilitySchema>;
