# Per-capture post visibility at ingest time

**Date:** 2026-06-24
**Status:** Approved ("send it") — implementing

## Goal

Let a user choose a post's read visibility (`PRIVATE` / `FRIENDS` / `PUBLIC`) at the
moment they queue a capture, on both the web composer and the mobile Capture tab. The
chosen value rides the ingest submission to the worker, which stamps it on the Post it
creates.

## Decisions (from brainstorming)

- **Where:** Composer only (web + mobile). The composer selector *is* the "set the
  default for this post / choose public·private·friends" control. No stored per-user
  Settings preference. No new edit-after-publish UI (web's existing
  `PUT /api/app/posts/[slug]/visibility` stays untouched).
- **Default:** `PRIVATE` (the safe schema default) — composer pre-selects it each time.
- **Scope unit:** one selector per compose session, applied to every staged material —
  mirrors the existing `projectId` picker (single value applied to the whole tray).
- **Bearer endpoints:** accept visibility too. But `FRIENDS` is meaningless without a
  submitter, so on the bearer path `FRIENDS` is coerced to "unset" (→ `PRIVATE` default)
  with a warn log; `PRIVATE`/`PUBLIC` pass through.

## Data model

Add one nullable column to `IngestSubmission`, mirroring the `projectId` pattern:

```prisma
visibility PostVisibility?  // null → Post.visibility's PRIVATE default
```

- `null` = fall back to the `Post.visibility` schema default (`PRIVATE`). Covers
  pre-migration rows and bearer submits that omit it.
- Hand-authored migration (`20260624000000_ingest_submission_visibility`): the
  `PostVisibility` enum already exists in the DB (Post uses it), so the migration is a
  single `ALTER TABLE ... ADD COLUMN`. Applied via `migrate deploy` (migrate dev is
  non-interactive-hostile in the agent shell).

## Write path (the thread)

1. **Composer UI** (web `composer.tsx`, mobile `composer.tsx`): a 3-option visibility
   selector (radiogroup of chips), default `PRIVATE`, reset after submit. Value passed
   in the `SubmitContext`.
2. **Materials dispatch** (web `materials.ts`, mobile `materials.ts` + `ingest-submit.ts`):
   `SubmitContext` gains `visibility`. URL/note JSON bodies gain a `visibility` field;
   image/file multipart gains a `visibility` form field. Mobile threads it through every
   handler, including the offline-outbox `noteIngestBody` so replays carry it.
3. **Validation** (`apps/web/lib/ingest/schema.ts`): reuse the
   `z.enum(["PRIVATE","FRIENDS","PUBLIC"])` literal union. Add optional `visibility` to
   `urlIngestSchema`, `imageMetadataSchema`, `fileMetadataSchema` (empty string → undefined
   for the multipart paths). The `parse*` helpers in `submit.ts` read the new form field.
4. **Submit funnel** (`apps/web/lib/ingest/submit.ts`): a `resolveVisibility(submittedById,
   visibility)` helper drops `FRIENDS` when there's no submitter (bearer), then passes the
   value to `createSubmission`.
5. **DB helper** (`packages/db/src/ingest.ts`): `CreateSubmissionInput.visibility`, written
   on create and on the failed-row requeue (so a re-submit honors the latest pick).
6. **Worker** (`apps/worker/src/pipeline/post-writer.ts`): `getVisibility(input)` reads the
   submission row's `visibility` (image batch → first row, like `getSourceHash`). Set on the
   `Post.create` payload only — **not** on update, matching the existing `status` convention
   so a later manual visibility edit is never clobbered on reprocess. `null` → omit → schema
   default `PRIVATE`.

The 6 route handlers and the worker `pipeline.ts`/index need **no** change — bodies/metadata
pass straight through, and the worker reads visibility off the row it already loads.

## Out of scope (YAGNI)

- Per-user default visibility preference in Settings.
- Editing visibility on an already-published post (web endpoint already exists; mobile not added).
- Per-material (vs per-session) visibility.
- Changing visibility on an in-flight Queue item.
