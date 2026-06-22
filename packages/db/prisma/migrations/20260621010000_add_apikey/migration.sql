-- CreateTable: better-auth apiKey() plugin table (@@map("apikey")).
-- Backs the per-user MCP corpus API keys. All columns are plugin-managed.
-- `key` holds the HASHED key; `referenceId` is the owning user id (FK to "user").
CREATE TABLE "apikey" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT,
    "start" TEXT,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitTimeWindow" INTEGER,
    "rateLimitMax" INTEGER,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "permissions" TEXT,
    "metadata" TEXT,

    CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apikey_referenceId_idx" ON "apikey"("referenceId");

-- CreateIndex
CREATE INDEX "apikey_key_idx" ON "apikey"("key");

-- AddForeignKey
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
