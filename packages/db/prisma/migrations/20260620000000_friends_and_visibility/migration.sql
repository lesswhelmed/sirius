-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('PRIVATE', 'FRIENDS', 'PUBLIC');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- AlterTable: every existing post is backfilled to PRIVATE atomically by the
-- column default, so enabling sharing exposes nothing until owners opt in.
ALTER TABLE "Post" ADD COLUMN "visibility" "PostVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE INDEX "Post_submittedById_visibility_createdAt_idx" ON "Post"("submittedById", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Post_visibility_status_createdAt_idx" ON "Post"("visibility", "status", "createdAt");

-- CreateTable
CREATE TABLE "friendship" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "friendship_userAId_userBId_key" ON "friendship"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "friendship_userAId_status_idx" ON "friendship"("userAId", "status");

-- CreateIndex
CREATE INDEX "friendship_userBId_status_idx" ON "friendship"("userBId", "status");

-- CreateIndex
CREATE INDEX "friendship_requestedById_idx" ON "friendship"("requestedById");

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
