-- AlterEnum
ALTER TYPE "PostType" ADD VALUE 'SOCIAL';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Post" ADD COLUMN "contentDigest" JSONB;
