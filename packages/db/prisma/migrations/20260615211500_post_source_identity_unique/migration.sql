-- Enforce a post's true identity: at most one Post per (providerId, sourceRecordId).
-- A check-then-act race in the worker's post-writer (two concurrent runs of the
-- same submission both find no existing post and both CREATE with a different
-- model-derived slug) produced duplicate Post rows sharing a source identity.
-- Before the unique index can be added we must losslessly dedupe the existing
-- duplicate groups.
--
-- sourceRecordId is nullable; Postgres treats NULLs as distinct, so the unique
-- index below still permits many NULL-sourceRecordId posts (mdx / other
-- providers) — only non-NULL source identities are constrained.
--
-- Note: each statement is run independently by the migration engine, so we use
-- CTEs/subqueries rather than session temp tables (which would not survive
-- across statements) to identify keepers and losers.

-- Persistent (within the migration) mapping of every losing duplicate -> its
-- surviving keeper. The keeper for each (providerId, sourceRecordId) group is:
--   - the post referenced by an IngestSubmission.resultPostId (it carries the
--     retained-file links); else
--   - on none/tie, the oldest createdAt (then lowest id as a deterministic
--     final tiebreak).
-- Built as a real (non-temp) table so it persists across the statements below;
-- dropped at the end.
CREATE TABLE "_post_dedupe_map" AS
WITH ranked AS (
  SELECT p.id,
         p."providerId",
         p."sourceRecordId",
         p."createdAt",
         p."imageUrl",
         (SELECT count(*) FROM "IngestSubmission" s WHERE s."resultPostId" = p.id) AS fk_refs
  FROM "Post" p
  WHERE p."sourceRecordId" IS NOT NULL
    AND (p."providerId", p."sourceRecordId") IN (
      SELECT "providerId", "sourceRecordId"
      FROM "Post"
      WHERE "sourceRecordId" IS NOT NULL
      GROUP BY "providerId", "sourceRecordId"
      HAVING count(*) > 1
    )
),
keepers AS (
  SELECT DISTINCT ON ("providerId", "sourceRecordId")
         "providerId", "sourceRecordId", id AS keeper_id
  FROM ranked
  ORDER BY "providerId", "sourceRecordId", (fk_refs > 0) DESC, "createdAt" ASC, id ASC
)
SELECT r.id AS loser_id,
       k.keeper_id,
       r."imageUrl" AS loser_image_url
FROM ranked r
JOIN keepers k
  ON r."providerId" = k."providerId"
 AND r."sourceRecordId" = k."sourceRecordId"
WHERE r.id <> k.keeper_id;

-- Preserve a non-null imageUrl: if the keeper has none but a loser does, copy
-- the loser's imageUrl onto the keeper (so e.g. a video-thumbnail backfill on a
-- duplicate is not lost when the duplicate is deleted).
UPDATE "Post" keep
SET "imageUrl" = src.loser_image_url
FROM (
  SELECT DISTINCT ON (keeper_id) keeper_id, loser_image_url
  FROM "_post_dedupe_map"
  WHERE loser_image_url IS NOT NULL
  ORDER BY keeper_id, loser_image_url
) src
WHERE keep.id = src.keeper_id
  AND keep."imageUrl" IS NULL;

-- Repoint any IngestSubmission rows that point at a loser (by FK id) to the
-- keeper, so the retained-file download path stays intact and no FK orphans on
-- delete.
UPDATE "IngestSubmission" s
SET "resultPostId" = m.keeper_id,
    "resultPostSlug" = keep.slug
FROM "_post_dedupe_map" m
JOIN "Post" keep ON keep.id = m.keeper_id
WHERE s."resultPostId" = m.loser_id;

-- Also repoint submissions matched by a loser's slug only (resultPostId null but
-- resultPostSlug still pointing at a now-to-be-deleted duplicate's slug).
UPDATE "IngestSubmission" s
SET "resultPostSlug" = keep.slug
FROM "_post_dedupe_map" m
JOIN "Post" lose ON lose.id = m.loser_id
JOIN "Post" keep ON keep.id = m.keeper_id
WHERE s."resultPostSlug" = lose.slug
  AND s."resultPostSlug" IS DISTINCT FROM keep.slug;

-- Delete the duplicate Post rows. Their embeddings / category matches / saves /
-- views / tag & category links cascade.
DELETE FROM "Post" WHERE id IN (SELECT loser_id FROM "_post_dedupe_map");

-- Done with the mapping.
DROP TABLE "_post_dedupe_map";

-- Now the index can be created with no duplicate groups remaining.
CREATE UNIQUE INDEX "Post_providerId_sourceRecordId_key" ON "Post"("providerId", "sourceRecordId");
