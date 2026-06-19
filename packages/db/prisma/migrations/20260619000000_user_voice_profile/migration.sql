-- Per-user "author voice" used to shape generated post prose (tone only).
ALTER TABLE "user" ADD COLUMN "voiceProfile" TEXT;
