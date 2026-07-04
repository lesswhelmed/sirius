// Blackbox integration test for per-submitter ingest dedup + the failed-row
// retry ownership guard in createSubmission (packages/db/src/ingest.ts).
//
// Since migration 20260704120000_ingest_per_submitter_dedup, IngestSubmission
// dedup is PARTITIONED: attributed rows are unique per (submittedById,
// contentHash); unattributed bearer rows (submittedById IS NULL) stay globally
// unique on contentHash. This suite pins both the cross-tenant isolation that
// buys us AND the behaviour that must NOT change (own retry, bearer global
// dedup, own non-failed dedup).
//
// Mirrors the harness contract of search.integration.test.ts: gated on
// TEST_DATABASE_URL, run via `bun test --preload ./test/setup-env.ts`, seeds
// under a UNIQUE prefix, and in afterAll deletes ONLY its own rows (no
// truncate/reset — the tree is shared). The test DB must have the partial-index
// migration applied (db:migrate:deploy against TEST_DATABASE_URL).
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

suite("createSubmission per-submitter dedup + retry ownership", () => {
  afterAll(async () => {
    // Delete ONLY our own rows: every submission id we captured, plus any row
    // sharing our prefix hash (belt-and-braces), then our two users.
    await prisma.ingestSubmission.deleteMany({
      where: {
        OR: [
          { id: { in: createdSubmissionIds } },
          { contentHash: { startsWith: PREFIX } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  test("cross-user hash collision gives userB their OWN row and cannot touch userA's", async () => {
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

    // userB submits content whose hash equals userA's. Under per-submitter dedup
    // this is a DIFFERENT partition, so B is NOT deduped against A — B gets their
    // OWN new "created" row. (Pre-migration, the global unique returned A's row
    // as "deduped" and leaked A's id; the earlier unscoped updateMany even let B
    // flip A's failed row back to pending and clobber its payload.)
    const bSubmit = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "userB own payload", owner: "B" },
      submittedById: userBId,
    });
    expect(bSubmit.status).toBe("created");
    expect(bSubmit.submission.id).not.toBe(victimId);
    expect(bSubmit.submission.submittedById).toBe(userBId);
    createdSubmissionIds.push(bSubmit.submission.id);

    // The victim's row is untouched: still FAILED, still A's, payload intact.
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

  test("owner re-submitting an unfailed row is deduped (not retried)", async () => {
    const hash = `${PREFIX}-own-dedup`;

    const first = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "first" },
      submittedById: userAId,
    });
    expect(first.status).toBe("created");
    createdSubmissionIds.push(first.submission.id);

    // Leave it pending; same user, same content again → deduped to the same row.
    const again = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "second" },
      submittedById: userAId,
    });
    expect(again.status).toBe("deduped");
    expect(again.submission.id).toBe(first.submission.id);
  });

  test("unattributed bearer rows keep GLOBAL dedup (submittedById null)", async () => {
    const hash = `${PREFIX}-bearer`;

    const first = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "bearer first" },
      submittedById: null,
    });
    expect(first.status).toBe("created");
    createdSubmissionIds.push(first.submission.id);

    // A second unattributed submission of the same content dedups globally.
    const second = await createSubmission({
      kind: "note",
      contentHash: hash,
      payload: { note: "bearer second" },
      submittedById: null,
    });
    expect(second.status).toBe("deduped");
    expect(second.submission.id).toBe(first.submission.id);
  });
});
