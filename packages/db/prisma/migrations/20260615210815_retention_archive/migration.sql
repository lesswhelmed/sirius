-- AlterTable
ALTER TABLE "IngestSubmission" ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "originalMimeType" TEXT,
ADD COLUMN     "originalSizeBytes" INTEGER,
ADD COLUMN     "resultPostId" TEXT,
ADD COLUMN     "retainedFilePath" TEXT;

-- CreateTable
CREATE TABLE "ArchiveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "token" TEXT,
    "fileCount" INTEGER,
    "sizeBytes" INTEGER,
    "downloadPath" TEXT,
    "expiresAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ArchiveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRequest_token_key" ON "ArchiveRequest"("token");

-- CreateIndex
CREATE INDEX "ArchiveRequest_status_createdAt_idx" ON "ArchiveRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ArchiveRequest_userId_createdAt_idx" ON "ArchiveRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ArchiveRequest_token_idx" ON "ArchiveRequest"("token");

-- CreateIndex
CREATE INDEX "IngestSubmission_resultPostId_idx" ON "IngestSubmission"("resultPostId");

-- AddForeignKey
ALTER TABLE "IngestSubmission" ADD CONSTRAINT "IngestSubmission_resultPostId_fkey" FOREIGN KEY ("resultPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRequest" ADD CONSTRAINT "ArchiveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
