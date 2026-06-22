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

-- NOTE: plain (non-CONCURRENTLY) index builds. Prisma applies each migration
-- file inside a transaction, and CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block (it would abort `migrate deploy`). AiGenerationEvent is
-- small (free tier = a few generations/user/week), so the brief lock from a
-- regular index build is negligible.
CREATE UNIQUE INDEX "AiGenerationEvent_userId_sourceRecordId_key"
ON "AiGenerationEvent"("userId", "sourceRecordId");

CREATE INDEX "AiGenerationEvent_userId_status_reservationExpiresAt_idx"
ON "AiGenerationEvent"("userId", "status", "reservationExpiresAt");
