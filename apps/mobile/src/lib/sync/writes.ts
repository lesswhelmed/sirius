// The optimistic local-draft write path. When the user drafts a post on-device
// with the local LLM, we insert a `posts` row immediately so the Library renders
// it (via useLiveQuery) BEFORE the server has saved it. After the submission
// reaches the server we link the row to its submission id; reconciliation then
// merges the canonical server post into this same row (stable localId, no
// duplicate card) and clears the draft.
//
// Optimistic rows exist ONLY for on-device-drafted posts — when curation is off
// the server generates the content, so there's nothing to show locally until it
// syncs. That keeps the local store honest about what it actually knows.
import type { DraftEnvelope, SightDraftEnvelope } from "@repo/ingest-draft";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { db } from "@/lib/db/client";
import { type PostImage, posts } from "@/lib/db/schema";

export type LocalDraftType = "BLOG" | "FINDING" | "SIGHT";

type CreateLocalDraftInput = {
  type: LocalDraftType;
  envelope: DraftEnvelope | SightDraftEnvelope;
  // For SIGHT: the local image URIs, shown in the optimistic gallery until the
  // server URLs arrive on reconcile.
  imageUris?: string[];
};

function isSightEnvelope(
  envelope: DraftEnvelope | SightDraftEnvelope,
): envelope is SightDraftEnvelope {
  return "excerpt" in envelope.post;
}

/**
 * Insert an optimistic local_draft row from an on-device draft envelope.
 * Returns its stable localId, which the caller threads to the submission/outbox
 * so reconciliation can later find and merge this exact row.
 */
export async function createLocalDraft(
  input: CreateLocalDraftInput,
): Promise<string> {
  const localId = randomUUID();
  const { post } = input.envelope;
  const now = new Date();

  const alts = isSightEnvelope(input.envelope)
    ? input.envelope.post.imageAlts
    : undefined;
  const images: PostImage[] | null = input.imageUris?.length
    ? input.imageUris.map((url, i) => ({ url, alt: alts?.[i] }))
    : null;
  const excerpt = isSightEnvelope(input.envelope)
    ? input.envelope.post.excerpt
    : null;

  await db.insert(posts).values({
    localId,
    syncState: "local_draft",
    title: post.title,
    body: post.body,
    excerpt,
    type: input.type,
    tags: post.tags,
    categories: post.categories,
    imageUrl: images?.[0]?.url ?? null,
    images,
    draftEnvelopeJson: JSON.stringify(input.envelope),
    createdAt: now,
    updatedAt: now,
  });

  return localId;
}

/**
 * Link an optimistic row to its server submission once a submit succeeds. The
 * submissionId is the SubmitOk.id (note/url) or "batch:<batchId>" (images) — the
 * key the worker stamps onto Post.sourceRecordId. Flips local_draft → pending.
 * Guarded so it never clobbers a row that already reconciled to synced.
 */
export async function linkSubmission(
  localId: string,
  submissionId: string,
): Promise<void> {
  await db
    .update(posts)
    .set({ submissionId, syncState: "pending", updatedAt: new Date() })
    .where(and(eq(posts.localId, localId), eq(posts.syncState, "local_draft")));
}

/** Mark an optimistic row as permanently failed (a 4xx submit). Visible to the
 * user for retry/delete rather than silently dropped. */
export async function markLocalFailed(localId: string): Promise<void> {
  await db
    .update(posts)
    .set({ syncState: "failed", updatedAt: new Date() })
    .where(and(eq(posts.localId, localId), eq(posts.syncState, "local_draft")));
}

/** Drop an optimistic row entirely. Used when the on-device draft is abandoned
 * in favor of a different server path (e.g. an audio note the server rejected,
 * which then falls back to uploading the audio for server-side drafting). Only
 * deletes a still-optimistic row, never one that already reconciled. */
export async function deleteLocalDraft(localId: string): Promise<void> {
  await db
    .delete(posts)
    .where(and(eq(posts.localId, localId), eq(posts.syncState, "local_draft")));
}

/**
 * Optimistically apply an owner's body edit to a SYNCED mirror row so the change
 * shows instantly (useLiveQuery) before the PATCH round-trips. Deliberately does
 * NOT touch serverUpdatedAt — that must only ever be set from the server's
 * authoritative Post.updatedAt (see commitLocalPostEdit), or the LWW guard in
 * reconcile.ts could drop the real server delta. Guarded to `synced` so it never
 * races a draft/pending row.
 */
export async function applyLocalPostEdit(
  localId: string,
  fields: { title: string; excerpt: string | null; body: string },
): Promise<void> {
  await db
    .update(posts)
    .set({ title: fields.title, excerpt: fields.excerpt, body: fields.body })
    .where(and(eq(posts.localId, localId), eq(posts.syncState, "synced")));
}

/**
 * Commit the server's authoritative updatedAt onto the row AFTER a successful
 * PATCH. This keeps the LWW watermark correct: a later delta carrying the same
 * timestamp re-applies identical bytes (harmless), and any newer server change
 * still wins. Never set serverUpdatedAt to a client-guessed time.
 */
export async function commitLocalPostEdit(
  localId: string,
  serverUpdatedAtIso: string,
): Promise<void> {
  const ts = new Date(serverUpdatedAtIso);
  await db
    .update(posts)
    .set({ serverUpdatedAt: ts, updatedAt: ts })
    .where(eq(posts.localId, localId));
}

/**
 * Mark an optimistic row failed by localId, whether it is still a local_draft
 * or already linked to a pending submission. Used when the backing upload is
 * discarded before the batch could complete. Never clobbers a row that already
 * reconciled to `synced` or was tombstoned.
 */
export async function markPostFailedByLocalId(localId: string): Promise<void> {
  await db
    .update(posts)
    .set({ syncState: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(posts.localId, localId),
        inArray(posts.syncState, ["local_draft", "pending"]),
      ),
    );
}
