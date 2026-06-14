-- The `source` column was added with default 'dynamic', so rows that existed
-- before it (the seeded analysis-facet taxonomy) were mislabeled. Mark the seed
-- taxonomy (rooted at "analysis") as 'seed' so the dynamic topic resolver's
-- reuse comparison only ever sees the dynamic topic nodes (rooted at "topics").
UPDATE "CategoryEmbedding"
SET "source" = 'seed'
WHERE "path" = 'analysis' OR "path" LIKE 'analysis/%';