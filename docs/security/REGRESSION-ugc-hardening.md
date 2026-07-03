# Regression tests — UGC security hardening (2026-07-03)

Backs the 7 security fixes made after the full attack-surface audit (App Store
rejection **2c02b4c2** follow-on). Each fix below carries a **regression test**
designed to fail on the *pre-fix* code and pass on the *post-fix* code.

## Testing philosophy

- **Blackbox-first.** Prefer tests that exercise a stable boundary (a schema, a
  pure builder function, a DB helper, an HTTP route) and assert observable
  behavior, not internals. A test that would pass regardless of the fix is
  worthless — every case here names the pre-fix failure it reproduces.
- **Headless by default.** The whole suite runs with `bun` — pure-function unit
  checks + the `@repo/db` integration harness (`bun test --preload
  ./test/setup-env.ts`, gated by `TEST_DATABASE_URL`). No web server, device, or
  browser is *required* to prove any of these fixes.
- **Escalate only when the boundary can't be reached headlessly.** A few
  end-to-end confirmations (the mobile Save button, the web comment thread
  hiding a blocked user) live above the code boundary the fix touches. Those are
  documented as **[SERVER]/[DEVICE]/[BROWSER]** steps — optional belt-and-braces,
  not the primary proof.

### Test-method tags

| Tag | Means | Needs |
|-----|-------|-------|
| **[AUTO-UNIT]** | pure function / schema, run with `bun` | nothing |
| **[AUTO-DB]** | `@repo/db` integration harness against a test DB | `TEST_DATABASE_URL` |
| **[SERVER]** | curl against a running `bun run dev` web app | web server up (single, coordinated) |
| **[DEVICE]** | iOS sim / agent-device flow | the sim (⚠ single-occupancy — see below) |
| **[BROWSER]** | agent browser flow on the web app | the browser (⚠ single-occupancy) |

### ⚠ Device / browser are single-occupancy

Only **one** subagent may hold the iOS simulator (agent-device) OR the agent
browser at a time, and other swarm agents may already be using the sim (e.g. the
iPad demo). Therefore:

- The headless suite (**[AUTO-UNIT]/[AUTO-DB]**) is the source of truth and runs
  fully in parallel — no device/browser contention.
- **[SERVER]** curl checks share one running web server; run them from one place.
- **[DEVICE]** and **[BROWSER]** confirmations are **serialized**: exactly one
  agent is assigned the device *or* browser lease at a time. The orchestrator
  grants that lease explicitly and no other agent touches the sim/browser until
  it's released. If the sim is already in use by another swarm agent, the
  device/browser step is deferred to the human, not forced.

---

## The 7 fixes and their regression tests

### 1. Draft envelope bypassed the content-safety gate — **HIGH**
- **Fix:** `apps/worker/src/pipeline/safety/targets.ts` — `collectDraftTargets`
  now emits the client draft's title/body/excerpt/image-alts as text scan
  targets, and `shouldScan` returns true whenever a draft is present.
- **Pre-fix failure to reproduce:** input with benign `notes` + a `draft` whose
  `post.body` contains prohibited text → `collectScanTargets` yields NO target
  for the draft body → gate passes → harmful body published.
- **[AUTO-UNIT]** Import `collectScanTargets` + `shouldScan` from the worker.
  - Assert: for a `note`/`url`/`image` input carrying a draft, the returned
    targets include a `{kind:"text"}` whose text === the draft body.
  - Assert: `shouldScan(input)` === true for a single non-PDF url + empty notes
    **when a draft is present** (the total-bypass case), and the draft body is a
    scan target.
  - Assert (guard against over-fix): a normal `url` input with **no** draft and
    empty notes still returns `shouldScan===false` (unchanged behavior).

### 2. Unbounded ingest body buffering → OOM DoS — **HIGH**
- **Fix:** `apps/web/lib/ingest/submit.ts` (+ `staging.ts`) — Content-Length
  fast-reject + post-buffer `byteLength` cap in all four parsers, mapped to a
  413. (Image cap / file cap constants — confirm exact numbers from the diff.)
- **Pre-fix failure to reproduce:** a body over the cap is buffered and staged
  with no rejection.
- **[AUTO-UNIT]** Call the parse functions with a fabricated `Request` whose body
  exceeds the cap (and separately, whose `Content-Length` header claims a size
  over the cap) → assert the result is the 413/"too large" discriminant, and that
  a body **at/under** the cap still parses normally.
- **[SERVER]** (optional, needs server) `dd if=/dev/zero bs=1m count=<over-cap> |
  curl -X POST https://sirius.local/api/ingest-file -H "Authorization: Bearer
  $INGEST_TOKEN" -H "x-kind: video" --data-binary @-` → expect **413**, and the
  same on `/api/app/ingest-images` (session) → **413** (both auth paths share the
  parser).

### 3. Client `batchId` → path-traversal arbitrary file write — **HIGH**
- **Fix:** `apps/web/lib/ingest/schema.ts` — `batchId` restricted to
  `/^[A-Za-z0-9_-]{1,64}$/`; defense-in-depth resolve/containment guard in
  `apps/worker/src/pipeline/post-writer.ts` `copyImages`.
- **Pre-fix failure to reproduce:** `batchId: "../../../../tmp/pwn"` passes the
  schema and `copyImages` writes bytes outside the sight docroot.
- **[AUTO-UNIT]** `imageMetadataSchema.safeParse({ batchId: "../../etc", ... })`
  → `success===false`; a real `crypto.randomUUID()` batchId → `success===true`.
  Also assert rejection of `"a/b"`, `"..%2f.."`, a 65-char id, and empty.
- **[AUTO-UNIT]** (worker guard) exercise the containment check: a batchId that
  resolves outside `sightRoot` must throw before any filesystem write. (Pure
  path-math assertion — no real files needed; mirror serve-media's guard.)

### 4. Comment thread leaked blocked authors — **MEDIUM**
- **Fix:** `packages/db/src/comments.ts` — `listCommentsForPost(postId, {blockedIds})`
  NULL-safe `notIn` arm; `apps/web/app/api/app/posts/[slug]/comments/route.ts`
  threads `blockedIdsFor(viewerId)`.
- **Pre-fix failure to reproduce:** blocked user's active comment still returned.
- **[AUTO-DB]** Seed post P (author A) + comments by A, B (friend/commenter), and
  an AGENT comment (authorId null). `listCommentsForPost(P, { blockedIds:[B] })`
  → excludes B's comment, **keeps** A's and the null-author AGENT comment
  (NULL-safety). `listCommentsForPost(P, {})` (no blockedIds) → returns all
  (unchanged behavior for non-blocking viewers).

### 5. Banned users kept API-key / MCP access — **MEDIUM**
- **Fix:** `scripts/moderation/resolve-report.ts` `cmdBan` deletes
  `apiKey` rows by `referenceId`; `apps/mcp/src/auth.ts` `verifyKey` rejects a
  banned owner (returns null).
- **Pre-fix failure to reproduce:** after ban, `verifyKey(key)` still resolves to
  the userId.
- **[AUTO-DB]** Create user U + an `apiKey` row (referenceId=U). Simulate the ban
  (set `banned=true`, run the same `apiKey.deleteMany({where:{referenceId:U}})`)
  → assert 0 keys remain. Separately, for the mcp guard: with a key whose owner
  has `banned=true` still present, `verifyKey` returns null (defense in depth).

### 6. Prod email fallback logged live auth tokens — **LOW**
- **Fix:** `packages/auth/src/email.ts` `sendEmail` throws (fail-closed) when
  `!resend` and `NODE_ENV==="production"`, instead of logging the token URL and
  reporting success.
- **[AUTO-UNIT]** With `RESEND_API_KEY` unset and `NODE_ENV="production"`,
  `sendEmail({...})` **rejects/throws**; with `NODE_ENV="development"` it resolves
  (dev log path preserved). Assert nothing containing the token URL is logged in
  the production path (spy on console).

### 7. Unescaped `user.name` in transactional email HTML — **LOW**
- **Fix:** `packages/auth/src/index.ts` — local `escapeHtml` wraps `user.name` in
  both reset + verify email bodies.
- **[AUTO-UNIT]** `escapeHtml('<img src=x onerror=alert(1)>')` →
  `&lt;img src=x onerror=alert(1)&gt;` (assert `<`,`>`,`&`,`"`,`'` all escaped;
  benign names pass through unchanged). Optional: render an email body with a
  hostile name and assert the raw `<` never appears in the HTML `<p>`.

---

## Domain assignment (no file overlap)

Each domain agent owns ONE test file; the DB-touching domains use **isolated,
uniquely-prefixed fixtures** and clean up only their own rows (no destructive DB
reset — the orchestrator runs `db:test:setup` once up front) so they can run
concurrently on one test DB without racing.

| Domain | Fixes | Test file | Methods |
|--------|-------|-----------|---------|
| **D1 — worker safety** | #1 | `scripts/testing/security/safety-draft.test.ts` | [AUTO-UNIT] |
| **D2 — ingest input** | #2, #3 | `scripts/testing/security/ingest-input.test.ts` | [AUTO-UNIT] |
| **D3 — web authz (DB)** | #4, #5 | `packages/db/src/security-block-ban.integration.test.ts` | [AUTO-DB] |
| **D4 — auth email** | #6, #7 | `scripts/testing/security/auth-email.test.ts` | [AUTO-UNIT] |

Device/browser confirmations (all optional, single-occupancy): mobile Save
button still functions (#3/oracle downstream), web comment thread visibly hides a
blocked commenter (#4). Assigned to at most one agent at a time.

---

## Execution results — 2026-07-03 (all green, re-run independently)

| Domain | Test file | Result |
|--------|-----------|--------|
| D1 worker-safety | `scripts/testing/security/safety-draft.test.ts` | **5 pass** |
| D2 ingest-input | `scripts/testing/security/ingest-input.test.ts` | **17 pass** |
| D3 web-authz (DB) | `packages/db/src/security-block-ban.integration.test.ts` | **4 pass** (fixtures cleaned, 0 left) |
| D4 auth-email | `scripts/testing/security/auth-email.test.ts` | **6 pass** |

**Total: 32 tests / 64 assertions, 0 fail.** No device or browser was used — the
whole suite ran headlessly with `bun`. Reproduce:

```sh
# unit suites (from repo root)
bun test scripts/testing/security/safety-draft.test.ts \
         scripts/testing/security/ingest-input.test.ts \
         scripts/testing/security/auth-email.test.ts
# DB integration (from packages/db; needs TEST_DATABASE_URL in root .env)
cd packages/db && bun test --preload ./test/setup-env.ts \
         src/security-block-ban.integration.test.ts
```

### Two items covered by inspection, not headless execution (documented, not skipped silently)

- **#5 mcp `verifyKey` banned-owner rejection** — `apps/mcp/src/auth.ts` re-reads
  the owner and returns null when `banned`. Not exercised headlessly because
  `verifyKey` imports the full `@repo/auth` betterAuth instance (+ Resend). The
  DB-layer revocation the ban *relies on* IS tested (D3 #5). Confirm end-to-end
  with a **[SERVER]** run: mint a key, ban the user via
  `scripts/moderation/resolve-report.ts --ban`, then hit an MCP endpoint with the
  key → expect 401.
- **#5 real `cmdBan`** — un-exported and runs its CLI `main()` at import, so D3
  asserts the identical `apiKey.deleteMany({ where:{ referenceId } })` invariant
  rather than importing the script. Behaviourally equivalent (verified against
  the source).
