-- Reserve free-tier Gemini generation slots before the model call so parallel
-- worker processes cannot all pass the same weekly-count read.

ALTER TABLE "AiGenerationEvent"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed',
ADD COLUMN "reservationExpiresAt" TIMESTAMP(3),
ADD COLUMN "sourceRecordId" TEXT;

ALTER TABLE "AiGenerationEvent"
ADD CONSTRAINT "AiGenerationEvent_status_check"
CHECK ("status" IN ('reserved', 'completed')),
ADD CONSTRAINT "AiGenerationEvent_reserved_fields_check"
CHECK ("status" <> 'reserved' OR ("sourceRecordId" IS NOT NULL AND "reservationExpiresAt" IS NOT NULL)),
ADD CONSTRAINT "AiGenerationEvent_completed_expiry_check"
CHECK ("status" <> 'completed' OR "reservationExpiresAt" IS NULL);

CREATE UNIQUE INDEX CONCURRENTLY "AiGenerationEvent_userId_sourceRecordId_key"
ON "AiGenerationEvent"("userId", "sourceRecordId");

CREATE INDEX CONCURRENTLY "AiGenerationEvent_userId_status_reservationExpiresAt_idx"
ON "AiGenerationEvent"("userId", "status", "reservationExpiresAt");
