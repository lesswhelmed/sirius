-- Freemium: RevenueCat entitlement + server AI-generation metering.
-- UserEntitlement is written by the RevenueCat webhook and read by the worker
-- to decide the Pro bypass. AiGenerationEvent is a ledger (one row per server
-- Gemini generation) counted over a weekly window to enforce the free cap.

-- CreateTable
CREATE TABLE "UserEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPro" BOOLEAN NOT NULL DEFAULT false,
    "rcAppUserId" TEXT,
    "rcCustomerId" TEXT,
    "entitlementId" TEXT,
    "productId" TEXT,
    "store" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastEventId" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEntitlement_userId_key" ON "UserEntitlement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEntitlement_rcAppUserId_key" ON "UserEntitlement"("rcAppUserId");

-- CreateIndex
CREATE INDEX "UserEntitlement_rcAppUserId_idx" ON "UserEntitlement"("rcAppUserId");

-- CreateIndex
CREATE INDEX "UserEntitlement_expiresAt_idx" ON "UserEntitlement"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserEntitlement" ADD CONSTRAINT "UserEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AiGenerationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resultPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiGenerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiGenerationEvent_userId_createdAt_idx" ON "AiGenerationEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiGenerationEvent" ADD CONSTRAINT "AiGenerationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
