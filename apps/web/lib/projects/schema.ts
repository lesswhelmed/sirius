// Request validators for the aspirations/projects endpoints. Mirrors the style
// of lib/ingest/schema.ts. The DB helpers enforce ownership/existence, so id
// fields here only need to be non-empty strings.
import { z } from "zod";

export const aspirationCreateSchema = z.object({
  title: z.string().trim().min(1, "title required").max(120),
  description: z.string().trim().max(2000).optional(),
});

export const aspirationUpdateSchema = aspirationCreateSchema.partial();

export const projectCreateSchema = z.object({
  title: z.string().trim().min(1, "title required").max(120),
  description: z.string().trim().max(2000).optional(),
  aspirationId: z.string().min(1).nullable().optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial().extend({
  status: z.enum(["active", "archived"]).optional(),
});

export const assignSchema = z.object({
  projectId: z.string().min(1).nullable(),
});

export type AspirationCreateInput = z.infer<typeof aspirationCreateSchema>;
export type AspirationUpdateInput = z.infer<typeof aspirationUpdateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type AssignInput = z.infer<typeof assignSchema>;
