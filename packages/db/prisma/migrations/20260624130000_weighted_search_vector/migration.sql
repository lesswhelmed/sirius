-- Replace the unweighted GENERATED searchVector with a trigger-maintained,
-- field-weighted tsvector that also indexes linked tag + category names.
-- Weights: title=A, tags+categories=B, excerpt=C, content=D.

-- 1. Drop the generated column (also drops its dependent GIN index).
ALTER TABLE "Post" DROP COLUMN "searchVector";

-- 2. Re-add as a plain, trigger-maintained tsvector.
ALTER TABLE "Post" ADD COLUMN "searchVector" tsvector;

-- 3. Pure compute function: row text + linked labels, weighted.
--    _PostToTag: "A"=Post, "B"=Tag.  _PostToCategory: "A"=Category, "B"=Post.
CREATE OR REPLACE FUNCTION post_search_vector(
  p_id text, p_title text, p_excerpt text, p_content text
) RETURNS tsvector LANGUAGE sql STABLE AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('english',
      coalesce((
        SELECT string_agg(t."name", ' ')
        FROM "_PostToTag" pt JOIN "Tag" t ON t."id" = pt."B"
        WHERE pt."A" = p_id
      ), '') || ' ' ||
      coalesce((
        SELECT string_agg(c."displayName" || ' ' || c."name", ' ')
        FROM "_PostToCategory" pc JOIN "Category" c ON c."id" = pc."A"
        WHERE pc."B" = p_id
      ), '')
    ), 'B') ||
    setweight(to_tsvector('english', coalesce(p_excerpt, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(p_content, '')), 'D')
$$;

-- 4. BEFORE INSERT/UPDATE on Post text columns: recompute from NEW.
CREATE OR REPLACE FUNCTION post_search_vector_biu() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" := post_search_vector(NEW."id", NEW."title", NEW."excerpt", NEW."content");
  RETURN NEW;
END $$;

CREATE TRIGGER post_search_vector_biu_trg
  BEFORE INSERT OR UPDATE OF "title", "excerpt", "content" ON "Post"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_biu();

-- 5. Linkage triggers: when a tag/category link changes, recompute the post.
--    Updating only "searchVector" does NOT re-fire post_search_vector_biu_trg
--    (it is scoped to title/excerpt/content), so there is no recursion.
CREATE OR REPLACE FUNCTION post_search_vector_tag_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := COALESCE(NEW."A", OLD."A");
BEGIN
  UPDATE "Post" SET "searchVector" =
    post_search_vector("id", "title", "excerpt", "content")
  WHERE "id" = pid;
  RETURN NULL;
END $$;

CREATE TRIGGER post_search_vector_tag_link_trg
  AFTER INSERT OR DELETE ON "_PostToTag"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_tag_link();

CREATE OR REPLACE FUNCTION post_search_vector_cat_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid text := COALESCE(NEW."B", OLD."B");
BEGIN
  UPDATE "Post" SET "searchVector" =
    post_search_vector("id", "title", "excerpt", "content")
  WHERE "id" = pid;
  RETURN NULL;
END $$;

CREATE TRIGGER post_search_vector_cat_link_trg
  AFTER INSERT OR DELETE ON "_PostToCategory"
  FOR EACH ROW EXECUTE FUNCTION post_search_vector_cat_link();

-- 6. Backfill every existing row.
UPDATE "Post" SET "searchVector" =
  post_search_vector("id", "title", "excerpt", "content");

-- 7. Recreate the GIN index.
CREATE INDEX "post_search_vector_idx" ON "Post" USING GIN ("searchVector");
