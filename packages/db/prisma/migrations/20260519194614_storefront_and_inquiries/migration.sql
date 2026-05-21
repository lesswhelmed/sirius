/*
  Warnings:

  - A unique constraint covering the columns `[handle]` on the table `user` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "IngestSubmission" ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "handle" TEXT,
ADD COLUMN     "location" TEXT;

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inquiry_sellerId_status_createdAt_idx" ON "Inquiry"("sellerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_postId_idx" ON "Inquiry"("postId");

-- CreateIndex
CREATE INDEX "Inquiry_fromUserId_idx" ON "Inquiry"("fromUserId");

-- CreateIndex
CREATE INDEX "IngestSubmission_submittedById_idx" ON "IngestSubmission"("submittedById");

-- CreateIndex
CREATE INDEX "Post_submittedById_idx" ON "Post"("submittedById");

-- CreateIndex
CREATE INDEX "Post_submittedById_status_createdAt_idx" ON "Post"("submittedById", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_handle_key" ON "user"("handle");

-- CreateIndex
CREATE INDEX "user_handle_idx" ON "user"("handle");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestSubmission" ADD CONSTRAINT "IngestSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
