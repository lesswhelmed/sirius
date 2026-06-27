-- CreateEnum: per-group identity exposure (default most-private).
CREATE TYPE "ShareGroupVisibility" AS ENUM ('PRIVATE', 'NAMED');

-- AlterEnum: add GROUP to PostVisibility. Safe inside this migration's
-- transaction on PG12+ because the new value is NOT *used* (no row written with
-- it) in this same migration — it only appears in later application DML.
ALTER TYPE "PostVisibility" ADD VALUE 'GROUP';

-- AlterTable: per-submission chosen groups (create-only seam to the worker).
ALTER TABLE "IngestSubmission"
  ADD COLUMN "shareGroupIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: ShareGroup
CREATE TABLE "ShareGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "ShareGroupVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShareGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShareGroup_ownerId_name_key" ON "ShareGroup"("ownerId", "name");
CREATE INDEX "ShareGroup_ownerId_idx" ON "ShareGroup"("ownerId");

-- CreateTable: ShareGroupMember
CREATE TABLE "ShareGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShareGroupMember_groupId_userId_key" ON "ShareGroupMember"("groupId", "userId");
CREATE INDEX "ShareGroupMember_userId_idx" ON "ShareGroupMember"("userId");
CREATE INDEX "ShareGroupMember_groupId_idx" ON "ShareGroupMember"("groupId");

-- CreateTable: PostShareGroup
CREATE TABLE "PostShareGroup" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostShareGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostShareGroup_postId_groupId_key" ON "PostShareGroup"("postId", "groupId");
CREATE INDEX "PostShareGroup_groupId_idx" ON "PostShareGroup"("groupId");
CREATE INDEX "PostShareGroup_postId_idx" ON "PostShareGroup"("postId");

-- AddForeignKey (all cascade)
ALTER TABLE "ShareGroup" ADD CONSTRAINT "ShareGroup_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareGroupMember" ADD CONSTRAINT "ShareGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ShareGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareGroupMember" ADD CONSTRAINT "ShareGroupMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostShareGroup" ADD CONSTRAINT "PostShareGroup_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostShareGroup" ADD CONSTRAINT "PostShareGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ShareGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
