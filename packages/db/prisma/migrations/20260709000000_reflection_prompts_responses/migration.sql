-- Reflection layer: AI-generated questions inviting the post owner to write
-- their own take (the human-written counterpart to the AI raw analysis in
-- Post.content), plus the owner's answers. Purely additive — existing posts
-- simply have zero rows (NO backfill, by product decision).

-- CreateTable
CREATE TABLE "ReflectionPrompt" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReflectionPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReflectionResponse" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "audioPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReflectionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReflectionPrompt_postId_status_order_idx" ON "ReflectionPrompt"("postId", "status", "order");

-- CreateIndex
CREATE INDEX "ReflectionPrompt_updatedAt_idx" ON "ReflectionPrompt"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReflectionResponse_promptId_key" ON "ReflectionResponse"("promptId");

-- CreateIndex
CREATE INDEX "ReflectionResponse_postId_idx" ON "ReflectionResponse"("postId");

-- CreateIndex
CREATE INDEX "ReflectionResponse_updatedAt_idx" ON "ReflectionResponse"("updatedAt");

-- AddForeignKey
ALTER TABLE "ReflectionPrompt" ADD CONSTRAINT "ReflectionPrompt_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionResponse" ADD CONSTRAINT "ReflectionResponse_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "ReflectionPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionResponse" ADD CONSTRAINT "ReflectionResponse_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReflectionResponse" ADD CONSTRAINT "ReflectionResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
