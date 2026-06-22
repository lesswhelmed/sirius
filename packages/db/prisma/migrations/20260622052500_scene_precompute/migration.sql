-- CreateTable
CREATE TABLE "PostNeighbor" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "neighborId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostNeighbor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneLayout" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "positions" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "clusters" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "dimensionality" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneRecomputeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SceneRecomputeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostNeighbor_ownerId_idx" ON "PostNeighbor"("ownerId");

-- CreateIndex
CREATE INDEX "PostNeighbor_neighborId_idx" ON "PostNeighbor"("neighborId");

-- CreateIndex
CREATE UNIQUE INDEX "PostNeighbor_postId_neighborId_key" ON "PostNeighbor"("postId", "neighborId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneLayout_ownerId_key" ON "SceneLayout"("ownerId");

-- CreateIndex
CREATE INDEX "SceneRecomputeRequest_status_createdAt_idx" ON "SceneRecomputeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SceneRecomputeRequest_userId_idx" ON "SceneRecomputeRequest"("userId");

-- AddForeignKey
ALTER TABLE "PostNeighbor" ADD CONSTRAINT "PostNeighbor_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostNeighbor" ADD CONSTRAINT "PostNeighbor_neighborId_fkey" FOREIGN KEY ("neighborId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneRecomputeRequest" ADD CONSTRAINT "SceneRecomputeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

