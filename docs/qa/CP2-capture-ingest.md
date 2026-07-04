# CP2 — Capture & ingest pipeline (web + worker)

The core product loop: submit a URL / note / images → `IngestSubmission` row →
worker claims it → Gemini drafts → `Post` upserted → visible in the catalog.
Architecture reference: [`docs/ingest-flow.md`](../ingest-flow.md) and the
"ingest pipeline" section of the root `CLAUDE.md`.

State machine under test: `pending → processing → completed | failed`.

> Last full pass: ⏳ · Worker **must** be running for every scenario here.

**Shared anchors:** `apps/web/lib/ingest/submit.ts`,
`packages/db/src/ingest.ts`, `apps/worker/src/index.ts`,
`apps/worker/src/pipeline/pipeline.ts`, `apps/worker/src/pipeline/post-writer.ts`

**Ground-truth helpers:**
```sh
q "select id,status,error from \"IngestSubmission\" order by \"createdAt\" desc limit 5"
q "select slug,type,status from \"Post\" order by \"createdAt\" desc limit 5"
```

---

### ING-1 · URL → FINDING post, end to end  `P0` ⏳

**Automated:** `scripts/testing/e2e.sh <url>` runs exactly this
(submit → wait → verify). Prefer the script; do it manually only when
debugging.

**Steps:**
1. Signed in on web, submit a plain article URL through the composer.
2. Watch `/queue` — the row appears `pending`, then `processing`.
3. Wait for completion (`scripts/testing/wait-completed.sh <id>`).
4. Open the resulting post from the catalog.

**Expected:**
- Submission lands via `/api/app/ingest` with `submittedById` set (session path).
- Worker claims it (optimistic-lock `updateMany`), drafts via the two-step
  `url_context` flow, and the post type is **forced to FINDING** regardless of
  model output.
- Post renders at `/posts/<slug>` with title, body, tags/categories.

**Anchors:** + `apps/worker/src/pipeline/gemini-runner.ts`,
`apps/web/app/api/app/ingest/route.ts`

---

### ING-2 · Note → BLOG and image batch → SIGHT  `P0` ⏳

**Steps:**
1. Submit a free-text note through the composer → wait for completion.
2. Submit a multi-image capture → wait for completion.

**Expected:**
- Note produces a post with **type BLOG**; images produce **one** post with
  **type SIGHT** for the whole `batchId` (the worker waits until all
  `totalCount` rows of the batch are present before claiming any of it).
- SIGHT body images resolve: `IMAGE_N` placeholders were rewritten to
  `/sight/<batchId>/…` URLs and those URLs return 200 (runtime-written files
  are served by the catch-all route, not the static `public/` snapshot).

**Ground truth:**
```sh
q "select type from \"Post\" where slug='<slug>'"
curl -sk -o /dev/null -w '%{http_code}' https://sirius.local/sight/<batchId>/<file>  # → 200
```

**Anchors:** + `apps/web/app/api/app/ingest-images/route.ts`,
`apps/web/app/sight/[...path]/route.ts`, `apps/web/lib/media/serve-media.ts`

---

### ING-3 · Bearer-token ingest (iOS Shortcuts path)  `P1` ⏳

**Steps:**
1. `curl -sk https://sirius.local/api/ingest -H "Authorization: Bearer $INGEST_TOKEN" -H 'content-type: application/json' -d '{"url":"https://example.com/article"}'`
2. Repeat with a wrong token.

**Expected:** valid token → 2xx and a `pending` row **without**
`submittedById`; wrong token → 401 (constant-time compare) and no row.

**Anchors:** `apps/web/app/api/ingest/route.ts`, `apps/web/lib/ingest/auth.ts`

---

### ING-4 · Dedup is visible, and "Process again" overrides it  `P0` ⏳

The regression this guards: dedup used to masquerade as success — "queued!"
with nothing in the queue (memory: *share dedup silent success*).

**Steps:**
1. Submit the same URL twice from the composer.
2. On the duplicate, use the surfaced dedup affordance ("Process again").

**Expected:**
- Second submit does **not** silently claim success — the UI tells you it was
  already captured (server responded `deduped: true`) and offers to process
  again.
- "Process again" creates a genuinely new submission row.

**Ground truth:** row count for that `contentHash` goes 1 → 1 → 2 across the
three actions.

**Anchors:** `apps/web/lib/ingest/submit.ts` (contentHash),
`apps/mobile/src/lib/materials.ts` (mobile counterpart, see MOB-2)

---

### ING-5 · Failure path & queue visibility  `P1` ⏳

**Steps:**
1. Submit a URL that cannot be fetched (e.g. a non-resolving domain).
2. Watch `/queue`.

**Expected:** the dedicated extractors fall back to `url_context`; if drafting
still fails the row lands `failed` **with an error message** on the row — never
stuck in `processing` forever. Queue UI shows the failed state distinctly.
(Instagram/YouTube URLs exercise the dedicated `pipeline/instagram/` /
`pipeline/youtube/` paths and their fallback — spot-check one of each when
those files change.)

**Ground truth:** `q "select status,error from \"IngestSubmission\" where id='<id>'"`

**Anchors:** `apps/worker/src/pipeline/pipeline.ts`,
`apps/web/app/(app)/queue/`, `apps/web/app/api/app/queue/route.ts`

---

### ING-6 · Retained originals land in private storage  `P0` ⏳

Retention policy: on success the staged upload is **moved** (not deleted) into
`ORIGINALS_DIR`, keyed `{userId}/{submissionId}/…`, and is only reachable
owner-gated. Public exposure of this directory is a release blocker.

**Steps:**
1. Complete an image ingest (ING-2).
2. As the owner: `GET /api/app/posts/<slug>/source`.
3. Signed out (and as a different user): request the same URL.
4. Try a traversal: `GET /api/app/posts/<slug>/source?file=../../etc/passwd`
   (or the path-shaped equivalent the route accepts).

**Expected:** owner streams the original(s) with `Cache-Control: private,
no-store`; anyone else gets 401/404; traversal attempts are rejected; the file
exists on disk under `ORIGINALS_DIR` and `retainedFilePath` is recorded.

**Ground truth:**
```sh
q "select \"retainedFilePath\" from \"IngestSubmission\" where id='<id>'"
ls "<ORIGINALS_DIR>/<userId>/<submissionId>/"
```

**Anchors:** `apps/worker/src/pipeline/post-writer.ts`,
`apps/web/app/api/app/posts/[slug]/source/route.ts`,
`apps/web/lib/originals/serve-original.ts`

---

### ING-7 · Worker shutdown drains cleanly  `P2` ⏳

**Steps:** submit a slow job; while it's `processing`, SIGTERM the worker;
restart it.

**Expected:** the worker drains in-flight jobs for `INGEST_SHUTDOWN_DRAIN_MS`;
anything still `processing` after a kill is reclaimed by lease recovery on the
next worker run — no permanently wedged rows.

**Anchors:** `apps/worker/src/index.ts`

---

### ING-8 · Per-user dedup — same URL, two users, two posts  `P0` ✅

Migration `20260704120000_ingest_per_submitter_dedup` partitioned dedup: two
different users submitting the SAME url each get their OWN submission (pre-fix
user B's capture was swallowed into A's row + A's id leaked). Unattributed
bearer rows (`submittedById` NULL) stay globally deduped.

**Steps:** run the flow script against a **migrated** dev/test DB:
```sh
DATABASE_URL="$TEST_DATABASE_URL" bun run scripts/testing/dedup-flow.ts
```
It drives the real `contentHashForUrls` + `createSubmission`, creates + deletes
two fixture users only, and refuses a non-local `DATABASE_URL`.

**Expected (6 checks green):** userA→created; userB same url→**created, own
distinct row owned by B**; userA again→deduped to own row; userA force→new row;
bearer same url twice→created then globally deduped.

**Ground truth:** `q "select \"submittedById\",count(*) from \"IngestSubmission\" where \"contentHash\"='<h>' group by 1"` → one row per attributed submitter.

**Verified:** 2026-07-04 — script 6/6 pass against the migrated test DB; migration applied on prod.

**Anchors:** `packages/db/src/ingest.ts` (`createSubmission` partition findFirst),
`packages/db/prisma/migrations/20260704120000_ingest_per_submitter_dedup/`,
`apps/web/lib/ingest/hash.ts`, `scripts/testing/dedup-flow.ts`,
`packages/db/src/ingest-retry-ownership.integration.test.ts`

---

### ING-9 · Bearer ingest is rate-limited + AI-capped  `P1` ◑

A leaked static `INGEST_TOKEN` must not enable unlimited spend/flood. The bearer
routes enforce a pre-auth IP window + per-caller + global windows (→ 429); the
worker caps bearer AI drafts.

**Steps:**
```sh
for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code} " -X POST \
  https://sirius.local/api/ingest -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "content-type: application/json" -d '{"urls":["https://example.com"]}'; done; echo
```

**Expected:** accepted codes then **429** past ~`INGEST_RL_PER_MAX`/min with a
`Retry-After` header. Over `BEARER_AI_WINDOW_MAX`/day the worker stops drafting
bearer submissions (manual stub, never crashes).

**Verified:** unit-tested (`scripts/testing/security/ingest-rate-limit.test.ts`, 4 pass); route-level 429 not yet live-smoked.

**Anchors:** `apps/web/lib/ingest/auth.ts` (`enforceBearerRateLimit`),
`apps/web/app/api/ingest{,-images,-file}/route.ts`,
`apps/worker/src/pipeline/bearer-meter.ts`
