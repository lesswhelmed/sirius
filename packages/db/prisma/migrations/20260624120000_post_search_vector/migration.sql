-- Full-text search over Post bodies. A GENERATED STORED tsvector (immutable
-- because the regconfig is a constant literal) over title+excerpt+content, plus
-- a GIN index. Plain index — NOT CONCURRENTLY (that aborts inside the migrate
-- deploy transaction). Queried only via raw SQL (searchCorpus).
ALTER TABLE "Post"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce("title", '') || ' ' ||
      coalesce("excerpt", '') || ' ' ||
      coalesce("content", '')
    )
  ) STORED;

CREATE INDEX "post_search_vector_idx" ON "Post" USING GIN ("searchVector");
