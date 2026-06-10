-- AlterTable
ALTER TABLE "CategoryEmbedding" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProjectEmbedding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "retrievalText" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddingHash" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensionality" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEmbedding_projectId_key" ON "ProjectEmbedding"("projectId");

-- CreateIndex
CREATE INDEX "ProjectEmbedding_ownerId_idx" ON "ProjectEmbedding"("ownerId");

-- CreateIndex
CREATE INDEX "ProjectEmbedding_embeddingHash_idx" ON "ProjectEmbedding"("embeddingHash");

-- AddForeignKey
ALTER TABLE "ProjectEmbedding" ADD CONSTRAINT "ProjectEmbedding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
