// Zod schemas for the search tool's structured input/output. The input schema is
// what the AI SDK hands the language model as the tool's call signature; the
// output schema documents the structured content the tool returns. Keeping these
// as zod (not hand-rolled JSON) gives the AI SDK validated tool I/O for free.
import { z } from "zod";

export const PostSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A focused natural-language search query describing what the user is " +
        "looking for in their own posts.",
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("How many posts to return (default 6)."),
});

export type PostSearchInput = z.infer<typeof PostSearchInputSchema>;

export const ScoredPostSchema = z.object({
  serverId: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  score: z.number(),
});

export const PostSearchOutputSchema = z.object({
  posts: z.array(ScoredPostSchema),
});

export type PostSearchOutput = z.infer<typeof PostSearchOutputSchema>;

export const GetPostInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "The id of a post to open in full, taken from a search_posts result.",
    ),
});

export type GetPostInput = z.infer<typeof GetPostInputSchema>;
