-- AlterTable
ALTER TABLE "IngestSubmission" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "Aspiration" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Aspiration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "aspirationId" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Aspiration_ownerId_createdAt_idx" ON "Aspiration"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_ownerId_status_createdAt_idx" ON "Project"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Project_aspirationId_idx" ON "Project"("aspirationId");

-- CreateIndex
CREATE INDEX "IngestSubmission_projectId_idx" ON "IngestSubmission"("projectId");

-- CreateIndex
CREATE INDEX "Post_projectId_idx" ON "Post"("projectId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestSubmission" ADD CONSTRAINT "IngestSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aspiration" ADD CONSTRAINT "Aspiration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_aspirationId_fkey" FOREIGN KEY ("aspirationId") REFERENCES "Aspiration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
