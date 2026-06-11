-- CreateTable
CREATE TABLE "PostEmbedding" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "ownerId" TEXT,
    "retrievalText" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddingHash" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensionality" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostCategoryMatch" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostCategoryMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostEmbedding_postId_key" ON "PostEmbedding"("postId");

-- CreateIndex
CREATE INDEX "PostEmbedding_ownerId_idx" ON "PostEmbedding"("ownerId");

-- CreateIndex
CREATE INDEX "PostEmbedding_embeddingHash_idx" ON "PostEmbedding"("embeddingHash");

-- CreateIndex
CREATE INDEX "PostCategoryMatch_path_idx" ON "PostCategoryMatch"("path");

-- CreateIndex
CREATE UNIQUE INDEX "PostCategoryMatch_postId_path_key" ON "PostCategoryMatch"("postId", "path");

-- AddForeignKey
ALTER TABLE "PostEmbedding" ADD CONSTRAINT "PostEmbedding_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCategoryMatch" ADD CONSTRAINT "PostCategoryMatch_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
