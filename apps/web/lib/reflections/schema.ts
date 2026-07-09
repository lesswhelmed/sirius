import { z } from "zod";

// Body of a reflection answer (create via POST, edit via PATCH). Trimmed,
// non-empty, capped so a runaway paste can't bloat a row — same discipline as
// commentCreateSchema, with more headroom since answers can be long-form (and
// voice transcripts land here too).
export const reflectionResponseBodySchema = z
  .string()
  .trim()
  .min(1, "answer required")
  .max(20_000);

export const reflectionResponseCreateSchema = z.object({
  promptId: z.string().trim().min(1, "promptId required").max(128),
  body: reflectionResponseBodySchema,
});

export const reflectionResponseUpdateSchema = z.object({
  body: reflectionResponseBodySchema,
});

export type ReflectionResponseCreateInput = z.infer<
  typeof reflectionResponseCreateSchema
>;
export type ReflectionResponseUpdateInput = z.infer<
  typeof reflectionResponseUpdateSchema
>;
