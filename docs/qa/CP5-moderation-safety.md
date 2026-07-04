# CP5 — Moderation & safety (App Store Guideline 1.2)

The UGC-safety surface: content reports, directional user blocks, the Terms
gate, the 24-hour report SLA tooling, and the worker's pre-publish safety
guardrails. Server helpers live in `packages/db/src/moderation.ts`; the
guardrail design doc is [`docs/safety-guardrails.md`](../safety-guardrails.md).

Contracts under test:
- `POST /api/app/posts/[slug]/report` `{ reason, note? }` — reasons
  `OBJECTIONABLE | ABUSE | SPAM | OTHER`; idempotent upsert per
  (post, reporter); re-reporting **reopens** a resolved report.
- `POST /api/app/users/[handle]/block` `{ postSlug? }` / `DELETE …/block` —
  the segment resolves **user id first, then handle**.
- `blockedAuthorExclusion()` is ANDed into posts, search, AND embeddings
  predicates — the legs must not drift.

> Last full pass: ⏳ · Requires users A (author) and B (viewer), friended,
> with a FRIENDS post from A visible to B.

**Shared anchors:** `packages/db/src/moderation.ts`,
`apps/web/lib/moderation/alert.ts`, `apps/mobile/src/lib/moderation.ts`

---

### MOD-1 · Report a post (web + mobile)  `P0` ⏳

**Steps:**
1. As B on **web**: open A's post → report controls → pick a reason, add a
   note, submit. (Also reachable from the feed row's moderation menu.)
2. As B on **mobile**: long-press/menu on A's feed row → Report → pick a
   reason from the action sheet.
3. Report the same post again with a different reason.

**Expected:**
- Both platforms confirm the report; the reporter's UI reflects it.
- An admin alert email goes out with post + author + reporter context.
- Re-reporting does **not** stack a duplicate row — the existing row's
  reason/note refresh (idempotent upsert on `[postId, reporterId]`).

**Ground truth:**
```sh
q "select reason,status,count(*) over() from \"ContentReport\" where \"reporterId\"='<B>'"
# exactly 1 row for that post, status OPEN, reason = the latest one
```

**Anchors:** `apps/web/app/api/app/posts/[slug]/report/route.ts`,
`apps/web/app/(app)/posts/[slug]/report-block-controls.tsx`,
`apps/web/app/(app)/friends/post-moderation-menu.tsx`,
`apps/mobile/src/lib/moderation.ts`

---

### MOD-2 · Block a user hides their content everywhere  `P0` ⏳

**Steps:**
1. As B: block A (from the report flow's "report & block", the post detail
   controls, or the feed menu).
2. As B, recheck **every** read surface: Friends feed, direct URL to A's
   post, curated search for A's post title, the Explore/Tree scene, and A's
   profile/catalog.

**Expected:** A's content vanishes from all of them — feed, direct slug
(404), search (both FTS and embedding legs), embedding scene. The block is
**directional**: A is not notified, and (by product decision recorded in
`moderation.ts`) check what A should still see of B's content and verify that
too.

**Ground truth:**
```sh
q "select count(*) from \"UserBlock\""   # ordered-pair row exists once
# then re-run B's search: no hits for A's post
```

**Anchors:** + `packages/db/src/posts.ts`, `packages/db/src/search.ts`,
`packages/db/src/embeddings.ts` (all AND in `blockedAuthorExclusion()`),
`apps/web/app/api/app/users/[handle]/block/route.ts`

---

### MOD-3 · Unblock restores visibility  `P0` ⏳

**Steps:**
1. As B: Settings → Blocked Users → unblock A. (Mobile: the equivalent
   settings section, or `DELETE /api/app/users/<id>/block`.)
2. Recheck the MOD-2 surfaces.

**Expected:** the blocked list showed A with block date; after unblock A's
FRIENDS/PUBLIC posts reappear in feed and search (friendship permitting —
blocking + unfriending compose, they're separate mechanisms). Unblocking is
idempotent: a second DELETE doesn't error.

**Anchors:** `apps/web/app/(app)/settings/blocked-users-section.tsx`,
`apps/web/app/api/app/blocks/route.ts`

---

### MOD-4 · Report resolution CLI + 24h SLA  `P1` ⏳

Guideline 1.2 requires acting on reports within 24 hours; the SLA clock runs
on OPEN reports.

**Steps:**
1. With MOD-1's report OPEN, run the moderation CLI:
   `bun scripts/moderation/resolve-report.ts` (list mode / resolve mode — see
   the script header for flags).
2. Resolve the report with an action.
3. As B, re-report the same post.

**Expected:** the CLI lists OPEN reports with age; resolving flips the row to
RESOLVED and records the action; a **re-report reopens** the resolved row
(fresh complaint ⇒ fresh SLA clock).

**Ground truth:** `q "select status,\"resolvedAt\" from \"ContentReport\" where id='<id>'"`

**Anchors:** `scripts/moderation/resolve-report.ts`,
`packages/db/src/moderation.ts` (`listOpenReports`)

---

### MOD-5 · Worker safety guardrails (pre-publish gate)  `P1` ⏳

The worker scans user-produced material **before** a post is written; flagged
content must never publish. Harness: `bun run safety:try` (see
[`docs/safety-guardrails.md`](../safety-guardrails.md)).

**Steps:**
1. Run the harness against known-bad sample input:
   `bun --cwd apps/worker run safety:try` (→ `apps/worker/scripts/safety-try.ts`).
2. Submit a benign control through the normal pipeline.

**Expected:** flagged input → **no Post row**, submission quarantined, admin
email sent (device-removal path per the doc); the classifier fails **closed**
(a classifier error also blocks publish). Benign input publishes normally.
Image batches key the quarantine as `batch:<batchId>`.

**Anchors:** `apps/worker/src/pipeline/safety/`,
`apps/worker/scripts/safety-try.ts`, `docs/safety-guardrails.md`

---

### MOD-6 · Terms-of-Use gate  `P0` ⏳

Part A of the 1.2 compliance work: no one uses UGC surfaces without agreeing
to terms.

**Steps:**
1. New account: verify the sign-up Terms checkbox is required
   ([AUTH-1](CP1-auth-account.md)).
2. Legacy account: `q "update \"user\" set \"termsAcceptedAt\"=null where email='<test>'"`,
   then load any `(app)` page.
3. Accept via the gate panel.

**Expected:** the gate renders **instead of** the app (not a dismissable
banner); `/terms` and privacy links open from it; Accept POSTs
`/api/app/account/accept-terms`, stamps `termsAcceptedAt`, and the app
renders after refresh. Mobile sessions of a gated account: verify the
equivalent mobile behavior when the account is un-stamped.

**Anchors:** `apps/web/app/(app)/_chrome/terms-gate.tsx`,
`apps/web/app/api/app/account/accept-terms/route.ts`,
`apps/web/app/(public)/terms/page.tsx`

---

### MOD-7 · Web edit/publish runs through the safety gate  `P0` ✅

Closes the same bypass class as the draft-envelope hole, via the **edit** path:
`PATCH /api/app/posts/[slug]` used to write title/body/excerpt verbatim and flip
DRAFT→PUBLISHED (or mutate an already-live body) with **no scan**. It now scans
the final title/body/excerpt through the shared `@repo/safety` classifier
whenever the edit results in published content, **fail-closed**.

**Steps:**
1. As owner: `PATCH /api/app/posts/<published-slug>` with `{ content: "<clearly-flaggable text>" }`.
2. Repeat with a benign edit.
3. (Optional) unset `GEMINI_API_KEY` in the web env, repeat step 1.

**Expected:**
- Flagged → **422 `content-flagged`**; the post is **unchanged** (422 returns
  before `updatePostContent`).
- Benign → 200, post updates/publishes. Draft-only saves are not scanned.
- Scan error / missing key → **503**, never a silent publish.

**Ground truth:** `q "select left(content,60),status from \"Post\" where slug='<slug>'"` — unchanged after a 422.

**Verified:** 2026-07-04 on dev via authenticated fetch — flagged PATCH → `422
content-flagged`, post body unchanged (real Gemini scan).

**Anchors:** `apps/web/app/api/app/posts/[slug]/route.ts` (PATCH),
`packages/safety/src/evaluate.ts`, `packages/safety/src/scan.ts`,
`apps/web/lib/posts/schema.ts`

---

### MOD-8 · Server-side Terms gate on UGC mutations  `P0` ✅

MOD-6 covers the UI gate; this is the **server** enforcement — a session with
`termsAcceptedAt = null` cannot create/expose UGC via direct API calls. Safety
tools stay open.

**Steps:**
1. `q "update \"user\" set \"termsAcceptedAt\"=null where email='<test>'"`.
2. With that session: `PUT …/visibility`, `POST …/comments`, `POST /api/app/ingest`.
3. `POST …/report`.
4. Restore terms; retry step 2.

**Expected:**
- Gated mutations → **403 `{ error: "terms-required" }`** (distinct code, not 401).
- `report` is **NOT** gated (safety mechanism, like block) — reaches its own validation.
- After accepting, the next request succeeds (no cookieCache).

**Verified:** 2026-07-04 on dev — visibility PUT + comments POST → `403
terms-required`; report POST → `400 cannot report your own post` (not 403);
terms restored to original stamp.

**Anchors:** `apps/web/lib/session.ts` (`agreedOr403`); gated:
ingest{,-images,-file}, `posts/[slug]/{comments,route,visibility}`,
`friends/requests`, `groups{,/[id]}`; NOT gated: `posts/[slug]/report`
