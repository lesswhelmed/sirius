// Blackbox integration test for the failed-row-retry ownership guard in
// createSubmission (packages/db/src/ingest.ts). Mirrors the harness contract of
// search.integration.test.ts: gated on TEST_DATABASE_URL, run via
// `bun test --preload ./test/setup-env.ts`, seeds under a UNIQUE prefix, and in
// afterAll deletes ONLY its own rows (no truncate/reset — the tree is shared).
//
// Run:
//   cd packages/db && bun test --preload ./test/setup-env.ts \
//     src/ingest-retry-ownership.integration.test.ts
import { afterAll, describe, expect, test } from "bun:test";

import { createSubmission, prisma } from "./index";

const RUN_DB = !!process.env.TEST_DATABASE_URL;
if (!RUN_DB) {
  console.warn(
    "[ingest-retry-ownership.integration] TEST_DATABASE_URL unset — skipping DB integration suite.",
  );
}

// Unique per-run prefix so parallel/leftover rows never collide and cleanup can
// target exactly what this suite created.
const PREFIX = `ingretry-${Math.random().toString(36).slice(2, 10)}`;
const userAId = `${PREFIX}-userA`;
const userBId = `${PREFIX}-userB`;
const createdSubmissionIds: string[] = [];

async function makeUser(id: string): Promise<void> {
  await prisma.user.create({
    data: {
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      handle: id,
    },
  });
}

const suite = RUN_DB ? describe : describe.skip;

suite("createSubmission failed-row retry ownership guard", () => {
  afterAll(async () => {
    // Delete ONLY our own rows. Submissions first (FK submittedById is SetNull,
    // so order is not strictly required, but keep it tidy), then our two users.
    await prisma.ingestSubmission.deleteMany({
      where: { id: { in: createdSubmissionIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  test("cross-user hash collision cannot hijack another user's failed row", async () => {
    await makeUser(userAId);
    await makeUser(userBId);

    const hash = `${PREFIX}-collision`;
    const originalPayload = { note: "userA original payload", owner: "A" };

    // userA submits and we capture the row id.
    const created = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: originalPayload,
      submittedById: userAId,
    });
    expect(created.status).toBe("created");
    const victimId = created.submission.id;
    createdSubmissionIds.push(victimId);

    // Force userA's row to FAILED (the only state the retry branch touches).
    await prisma.ingestSubmission.update({
      where: { id: victimId },
      data: { status: "failed" },
    });

    // userB submits content whose hash collides with userA's FAILED row.
    const hijackAttempt = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "userB HIJACK payload", owner: "B" },
      submittedById: userBId,
    });

    // The global-unique contentHash still collides, so B gets the existing row
    // back as a plain "deduped" result — NOT a "retried" requeue.
    expect(hijackAttempt.status).toBe("deduped");
    expect(hijackAttempt.submission.id).toBe(victimId);

    // The victim's row is untouched: still FAILED, payload not overwritten.
    // (Pre-fix, the unscoped updateMany flipped it back to "pending" and
    // clobbered the payload with userB's.)
    const victim = await prisma.ingestSubmission.findUniqueOrThrow({
      where: { id: victimId },
    });
    expect(victim.status).toBe("failed");
    expect(victim.submittedById).toBe(userAId);
    expect(victim.payload).toEqual(originalPayload);
  });

  test("owner can still retry their own failed row (regression guard)", async () => {
    const hash = `${PREFIX}-own-retry`;

    const created = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "first attempt" },
      submittedById: userAId,
    });
    expect(created.status).toBe("created");
    const rowId = created.submission.id;
    createdSubmissionIds.push(rowId);

    await prisma.ingestSubmission.update({
      where: { id: rowId },
      data: { status: "failed" },
    });

    // Same user re-submits the same content → the requeue fires.
    const retry = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "second attempt (retry)" },
      submittedById: userAId,
    });

    expect(retry.status).toBe("retried");
    expect(retry.submission.id).toBe(rowId);
    expect(retry.submission.status).toBe("pending");
  });
});
