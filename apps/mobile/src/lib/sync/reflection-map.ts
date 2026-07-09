// Pure delta→row mapping for the reflection mirror — the seam between the wire
// shapes (events.ts) and the SQLite rows (db/schema.ts). Kept free of any
// runtime import (types only) so it unit-tests under plain `bun test`, same
// pattern as lib/chat/message-map.ts.
//
// Two hard-won rules from the comment pipeline apply here:
//   1. Coalesce every nullable/optional field to a concrete null before it
//      reaches the SQLite bind — an omitted server field arrives as
//      `undefined`, which expo-sqlite rejects (InvalidConvertibleException)
//      and would abort the whole pull.
//   2. Dates: better-fetch revives ISO strings in JSON responses into Date
//      OBJECTS at runtime, so a field typed `string` may arrive as a Date.
//      `new Date(value)` handles both.
import type {
  NewReflectionPromptRow,
  NewReflectionResponseRow,
} from "@/lib/db/schema";
import type { ReflectionPromptDelta, ReflectionResponseDelta } from "./events";

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function promptDeltaToRow(
  prompt: ReflectionPromptDelta,
): NewReflectionPromptRow {
  return {
    serverId: prompt.id,
    postSlug: prompt.postSlug,
    postId: prompt.postId ?? null,
    batchId: prompt.batchId,
    order: prompt.order ?? 0,
    question: prompt.question,
    rationale: prompt.rationale ?? null,
    status: prompt.status === "superseded" ? "superseded" : "active",
    createdAt: toDate(prompt.createdAt),
    updatedAt: toDate(prompt.updatedAt),
  };
}

export function responseDeltaToRow(
  response: ReflectionResponseDelta,
): NewReflectionResponseRow {
  return {
    serverId: response.id,
    promptServerId: response.promptId,
    postSlug: response.postSlug,
    body: response.body ?? "",
    hasAudio: response.hasAudio === true,
    createdAt: toDate(response.createdAt),
    updatedAt: toDate(response.updatedAt),
  };
}
