-- Content-safety guardrails: flagged-submission state + moderation audit trail.
-- Hand-authored (prisma migrate dev aborts non-interactively in the agent shell);
-- DDL generated via `prisma migrate diff` so it matches Prisma's conventions.
-- Plain CREATE INDEX (not CONCURRENTLY) so it runs inside migrate deploy's txn.

-- AlterTable: terminal "flagged" timestamp on a rejected submission.
ALTER TABLE "IngestSubmission" ADD COLUMN "flaggedAt" TIMESTAMP(3);

-- CreateTable: ModerationEvent (CYA audit row, one per flagged submission).
CREATE TABLE "ModerationEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "submittedById" TEXT,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "categories" TEXT[],
    "rationale" TEXT,
    "model" TEXT NOT NULL,
    "contentHash" TEXT,
    "quarantinePaths" TEXT[],
    "emailedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationEvent_submissionId_idx" ON "ModerationEvent"("submissionId");
CREATE INDEX "ModerationEvent_severity_idx" ON "ModerationEvent"("severity");
CREATE INDEX "ModerationEvent_createdAt_idx" ON "ModerationEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "ModerationEvent" ADD CONSTRAINT "ModerationEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "IngestSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
