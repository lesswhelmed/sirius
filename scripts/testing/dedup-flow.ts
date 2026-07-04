// Exercise the per-submitter ingest dedup END TO END through the REAL functions
// the app uses — `contentHashForUrls` (apps/web/lib/ingest/hash.ts, the exact
// hash a URL submission computes) + `createSubmission` (packages/db, the dedup
// core). It simulates two different users submitting the SAME url and shows that
// each gets their OWN post instead of the second being swallowed (the bug that
// migration 20260704120000_ingest_per_submitter_dedup closed), plus same-user
// dedup, force re-ingest, and bearer/global dedup.
//
// It CREATES then DELETES two fixture users + their submissions — nothing else.
//
// Run it against a DEV or TEST database (NOT prod). Examples:
//   # local dev DB (root .env DATABASE_URL):
//   bun run scripts/testing/dedup-flow.ts
//   # the dedicated test DB:
//   set -a; source .env; set +a
//   DATABASE_URL="$TEST_DATABASE_URL" bun run scripts/testing/dedup-flow.ts
//
// Exit code 0 = all assertions passed, 1 = a mismatch (or the flow errored).
import { contentHashForUrls } from "../../apps/web/lib/ingest/hash";
import { createSubmission, prisma } from "@repo/db";

// ---- pretty output helpers ----
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
const step = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let failures = 0;
function expect(label: string, cond: boolean, detail: string) {
  if (cond) ok(`${label} — ${detail}`);
  else {
    bad(`${label} — ${detail}`);
    failures++;
  }
}

// ---- safety: show + guard the target DB (never run against a remote/prod DB) ----
function describeDb(url: string): { label: string; host: string } {
  try {
    const u = new URL(url);
    return { label: `${u.pathname.replace(/^\//, "")}@${u.hostname}`, host: u.hostname };
  } catch {
    return { label: "(unparseable DATABASE_URL)", host: "" };
  }
}

const PREFIX = `dedupflow-${Math.random().toString(36).slice(2, 8)}`;
const userAId = `${PREFIX}-A`;
const userBId = `${PREFIX}-B`;
const URL_X = "https://example.com/dedup-flow-article";
const URL_Y = "https://example.com/dedup-flow-bearer";

async function makeUser(id: string) {
  await prisma.user.create({
    data: { id, name: id, email: `${id}@example.test`, emailVerified: true, handle: id },
  });
}

// The REAL submit path for a URL, condensed to what drives dedup: hash the url
// exactly like the web submit layer, then call the shared createSubmission.
async function submitUrl(opts: {
  url: string;
  submittedById: string | null;
  force?: boolean;
  notes?: string;
}) {
  const contentHash = contentHashForUrls([opts.url], opts.notes ?? "", opts.force ?? false);
  return createSubmission({
    kind: "url",
    contentHash,
    payload: { urls: [opts.url], notes: opts.notes ?? "" },
    submittedById: opts.submittedById,
    force: opts.force ?? false,
  });
}

async function main() {
  const db = describeDb(process.env.DATABASE_URL ?? "");
  console.log(`\x1b[1mPer-user ingest dedup — live flow\x1b[0m`);
  console.log(`DB: \x1b[36m${db.label}\x1b[0m`);
  if (db.host && !["localhost", "127.0.0.1", "::1"].includes(db.host)) {
    console.error(
      `\n\x1b[31mRefusing to run: DATABASE_URL host "${db.host}" is not local.\x1b[0m ` +
        `Point DATABASE_URL at a dev/test DB (e.g. TEST_DATABASE_URL).`,
    );
    process.exit(2);
  }

  await makeUser(userAId);
  await makeUser(userBId);

  step("1) userA submits URL X");
  const a1 = await submitUrl({ url: URL_X, submittedById: userAId });
  console.log(`   → status=${a1.status} id=${a1.submission.id} owner=${a1.submission.submittedById}`);
  expect("userA gets a fresh row", a1.status === "created", `status=${a1.status}`);
  const aRowId = a1.submission.id;

  step("2) userB submits the SAME URL X  (the isolation check)");
  const b1 = await submitUrl({ url: URL_X, submittedById: userBId });
  console.log(`   → status=${b1.status} id=${b1.submission.id} owner=${b1.submission.submittedById}`);
  expect("userB is NOT deduped into userA's row", b1.status === "created", `status=${b1.status} (pre-fix this was "deduped")`);
  expect("userB gets a DISTINCT row", b1.submission.id !== aRowId, `B.id=${b1.submission.id} A.id=${aRowId}`);
  expect("userB's row is owned by userB (no id leak)", b1.submission.submittedById === userBId, `owner=${b1.submission.submittedById}`);

  step("3) userA submits URL X again, no force  (same-user dedup still works)");
  const a2 = await submitUrl({ url: URL_X, submittedById: userAId });
  console.log(`   → status=${a2.status} id=${a2.submission.id}`);
  expect("userA is deduped to their own existing row", a2.status === "deduped" && a2.submission.id === aRowId, `status=${a2.status} id=${a2.submission.id}`);

  step("4) userA submits URL X with force=true  (salted hash bypasses dedup)");
  const a3 = await submitUrl({ url: URL_X, submittedById: userAId, force: true });
  console.log(`   → status=${a3.status} id=${a3.submission.id}`);
  expect("force re-ingest creates a new row", a3.status === "created" && a3.submission.id !== aRowId, `status=${a3.status}`);

  step("5) bearer (no user) submits URL Y twice  (unattributed stays GLOBALLY deduped)");
  const bearer1 = await submitUrl({ url: URL_Y, submittedById: null });
  const bearer2 = await submitUrl({ url: URL_Y, submittedById: null });
  console.log(`   → first=${bearer1.status} second=${bearer2.status}`);
  expect("first bearer submit creates", bearer1.status === "created", `status=${bearer1.status}`);
  expect("second bearer submit is deduped globally", bearer2.status === "deduped" && bearer2.submission.id === bearer1.submission.id, `status=${bearer2.status}`);

  console.log(
    failures === 0
      ? `\n\x1b[32m\x1b[1mALL ${"6"} CHECKS PASSED — per-user dedup flow is correct.\x1b[0m`
      : `\n\x1b[31m\x1b[1m${failures} CHECK(S) FAILED.\x1b[0m`,
  );
}

main()
  .catch((err) => {
    console.error("\n\x1b[31mflow errored:\x1b[0m", err instanceof Error ? err.stack ?? err.message : err);
    failures++;
  })
  .finally(async () => {
    // Delete ONLY our fixtures: every submission owned by our two users (any
    // status), plus the bearer rows we created (by their prefixed url payload is
    // awkward to match, so also sweep by the two user ids first), then the users.
    await prisma.ingestSubmission.deleteMany({
      where: { OR: [{ submittedById: { in: [userAId, userBId] } }] },
    });
    // Bearer rows have no submitter; delete the two urls' unattributed rows we made.
    await prisma.ingestSubmission.deleteMany({
      where: { submittedById: null, contentHash: contentHashForUrls([URL_Y], "", false) },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  });
