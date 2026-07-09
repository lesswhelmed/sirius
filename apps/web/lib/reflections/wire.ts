// Wire shape for the reflection thread, shared by the API routes and the
// listing page's server-rendered section so the two can't drift.
//
// PRIVACY: audioPath (a private-filesystem pointer) is never sent verbatim —
// it maps to a hasAudio flag plus the canReadPost-gated streaming URL
// (/api/app/posts/[slug]/reflections/audio/[promptId]).
import type { ReflectionThreadItem } from "@repo/db";

export type ReflectionResponseWire = {
  id: string;
  body: string;
  hasAudio: boolean;
  // Streaming URL for the audio answer (route gated by canReadPost); null for
  // text-only answers.
  audioUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReflectionItemWire = {
  id: string;
  batchId: string;
  order: number;
  question: string;
  rationale: string | null;
  status: "active" | "superseded";
  createdAt: string;
  updatedAt: string;
  // Null = unanswered (the owner sees a composer).
  response: ReflectionResponseWire | null;
};

export function toReflectionItemWire(
  item: ReflectionThreadItem,
  postSlug: string,
): ReflectionItemWire {
  return {
    id: item.id,
    batchId: item.batchId,
    order: item.order,
    question: item.question,
    rationale: item.rationale,
    status: item.status === "superseded" ? "superseded" : "active",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    response: item.response
      ? {
          id: item.response.id,
          body: item.response.body,
          hasAudio: item.response.audioPath != null,
          audioUrl:
            item.response.audioPath != null
              ? `/api/app/posts/${postSlug}/reflections/audio/${item.id}`
              : null,
          createdAt: item.response.createdAt.toISOString(),
          updatedAt: item.response.updatedAt.toISOString(),
        }
      : null,
  };
}
