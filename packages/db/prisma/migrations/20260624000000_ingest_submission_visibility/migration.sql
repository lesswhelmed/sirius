-- Per-capture post visibility chosen at submit time, copied onto the Post by the
-- worker. Nullable: null falls back to Post.visibility's PRIVATE default. The
-- PostVisibility enum already exists (Post.visibility), so this is a plain column add.
ALTER TABLE "IngestSubmission" ADD COLUMN "visibility" "PostVisibility";
