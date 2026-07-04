-- Per-submitter ingest dedup.
--
-- Before: IngestSubmission.contentHash was GLOBALLY unique, so user B submitting
-- the same URL/file as user A collided with A's row → B got HTTP 200 deduped:true
-- pointing at A's submission (B's capture swallowed, A's id leaked cross-tenant).
--
-- After: uniqueness is PARTITIONED into two PARTIAL unique indexes:
--   1. unattributed bearer rows (submittedById IS NULL) stay GLOBALLY unique — the
--      iOS-Shortcut/script path has no user to scope to, so global dedup is correct.
--   2. attributed rows (submittedById IS NOT NULL) are unique PER (submittedById,
--      contentHash) — each user gets their own row for identical content.
--
-- No data backfill is needed: the old global unique already guaranteed at most one
-- row per contentHash, so both new (stricter-partitioned) constraints already hold
-- for every existing row.
--
-- DRIFT NOTE: Prisma's schema DSL cannot express partial / WHERE indexes, so
-- prisma/schema.prisma leaves contentHash a plain String (documented there). A
-- `prisma migrate diff` will therefore report these two indexes as drift — that is
-- EXPECTED and intentional; do not "fix" it by dropping them. Prisma 7 applies this
-- raw SQL verbatim on migrate deploy.
--
-- LOCKING NOTE: plain CREATE UNIQUE INDEX (NOT CONCURRENTLY — CONCURRENTLY cannot
-- run inside migrate deploy's transaction and would abort it). Each takes a brief
-- ACCESS EXCLUSIVE lock on IngestSubmission; negligible on this small table.

DROP INDEX "IngestSubmission_contentHash_key";

CREATE UNIQUE INDEX "IngestSubmission_contentHash_unattributed_key" ON "IngestSubmission"("contentHash") WHERE "submittedById" IS NULL;

CREATE UNIQUE INDEX "IngestSubmission_submitter_contentHash_key" ON "IngestSubmission"("submittedById", "contentHash") WHERE "submittedById" IS NOT NULL;
