-- Durable "how was the body produced" marker. "full" = AI pipeline drafted or
-- analyzed it; "stub" = over-quota degraded bookmark (no AI pass) — the gate
-- for the Pro "Regenerate with AI" flow and the upgrade CTA badges.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "aiTreatment" TEXT NOT NULL DEFAULT 'full';

-- AlterTable (audit copy of what a completed processing run produced)
ALTER TABLE "IngestSubmission" ADD COLUMN "aiTreatment" TEXT;

-- CreateIndex ("my N regeneratable bookmarks" queries)
CREATE INDEX "Post_submittedById_aiTreatment_idx" ON "Post"("submittedById", "aiTreatment");

-- Marker-only backfill (user-approved 2026-07-09, the sole exception to the
-- no-backfill rule): pre-marker over-quota stubs are identifiable only by the
-- fixed placeholder body the old buildManualStub wrote. Match on the exact
-- prefix (url stubs carry a trailing "Source:" line, so prefix, not equality)
-- and restrict to ingest-produced posts. No content, prompts, or other data
-- are touched — this only lets old stubs badge and regenerate.
UPDATE "Post"
SET "aiTreatment" = 'stub'
WHERE "providerId" = 'ingest'
  AND "content" LIKE '> Draft saved. You''ve used your free AI generations for this week%';
