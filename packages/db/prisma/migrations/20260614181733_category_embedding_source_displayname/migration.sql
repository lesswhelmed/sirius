-- AlterTable
ALTER TABLE "CategoryEmbedding" ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'dynamic';

-- CreateIndex
CREATE INDEX "CategoryEmbedding_source_idx" ON "CategoryEmbedding"("source");
