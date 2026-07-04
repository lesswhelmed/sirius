# CP7 — Data ownership, export & deletion

The retention promises: originals are kept until the user deletes the post,
everything is exportable from `/settings`, and deletion actually deletes.
Storage layout: `ORIGINALS_DIR` + `ARCHIVES_DIR` live **outside** any public/
Caddy root; the only access paths are the owner-gated routes below.

> Last full pass: ⏳ · Requires a test account with completed URL, note, and
> image-batch posts (run [CP2](CP2-capture-ingest.md) first).

**Shared anchors:** `apps/web/lib/originals/serve-original.ts`,
`packages/db/src/posts.ts`

---

### DATA-1 · Owner-gated source & notes access  `P0` ⏳

(Extends [ING-6](CP2-capture-ingest.md); run the access matrix here.)

**Steps:** for one image-batch post and one note post, request
`GET /api/app/posts/<slug>/source` and `GET /api/app/posts/<slug>/notes` as:
owner → friend → signed-out.

**Expected:** owner gets the original bytes (JSON file-index for batches) and
the synthesized `.md`/`.txt` notes, with `private, no-store` headers;
friend and signed-out get 401/404 — friendship grants **post** visibility,
never source access.

**Anchors:** `apps/web/app/api/app/posts/[slug]/source/route.ts`,
`apps/web/app/api/app/posts/[slug]/notes/route.ts`

---

### DATA-2 · Post detail renders every type  `P1` ⏳

**Steps:** open one FINDING, one BLOG, one SIGHT post on web
(`/posts/<slug>`) and mobile (`siriusapp://post/<slug>`).

**Expected:** body markdown renders (including links); SIGHT images load from
`/sight/...`; tags/categories display; the audience picker shows the current
visibility to the owner. Mobile respects the dual theme in both light and
dark (markdown styles must not leak light defaults into dark — regression
commit 11c5a5e).

**Anchors:** `apps/web/app/(app)/posts/[slug]/page.tsx`,
`apps/mobile/src/app/post/[slug]/index.tsx`

---

### DATA-3 · Archive export end to end  `P0` ⏳

**Steps:**
1. As the owner: `/settings` → request data export
   (`POST /api/app/archive`).
2. Wait for the worker to build it (same poll loop as ingest — worker must be
   running).
3. Open the emailed link (`GET /api/app/archive/download?token=…`) — in a
   **signed-out** browser window.
4. Unzip and inspect.
5. Re-request the same URL after tampering with the token; and (if a
   short-TTL row is seeded) after expiry.

**Expected:**
- `ArchiveRequest` row is created and completed by the worker; zip lands in
  `ARCHIVES_DIR`.
- The download is **token-gated, not session-gated** — it works signed out
  (that's how the email link must behave), but a wrong token gets 401/404.
- The zip contains the user's originals + note text — and nothing from any
  other user.
- Expired tokens (past `ARCHIVE_TTL_HOURS`, default 7d) are refused.

**Ground truth:**
```sh
q "select status from \"ArchiveRequest\" order by \"createdAt\" desc limit 1"
unzip -l <archive.zip>   # every path belongs to the requesting user
```

**Anchors:** `apps/web/app/api/app/archive/route.ts`,
`apps/web/app/api/app/archive/download/route.ts`,
`apps/worker/src/archive/run-archive.ts`

---

### DATA-4 · Post deletion cleans up everything  `P0` ⏳

**Steps:**
1. Note the post's `retainedFilePath`(s) and any `/sight/<batchId>/` files.
2. As the owner: delete the post (`DELETE /api/app/posts/<slug>` via the UI).
3. Recheck: post URL, catalog, feed (as a friend), search, the retained file
   on disk.
4. As a **non-owner**: attempt the DELETE on someone else's post.

**Expected:**
- Post 404s everywhere; source rows gone; retained originals removed from
  disk; friend's feed and search no longer surface it.
- Non-owner DELETE is refused and deletes nothing.

**Ground truth:**
```sh
q "select count(*) from \"Post\" where slug='<slug>'"          # → 0
ls "<ORIGINALS_DIR>/<userId>/<submissionId>/" 2>&1              # → No such file
```

**Anchors:** `apps/web/app/api/app/posts/[slug]/route.ts` (DELETE),
`apps/web/lib/originals/serve-original.ts`

---

### DATA-5 · Account deletion cascades  `P1` ⏳

The account-level version of DATA-4 — steps live in
[AUTH-8](CP1-auth-account.md). When running it, additionally verify here:
originals directory for the user is gone, their posts are out of friends'
feeds/search, and their `ContentReport`/block rows don't break other users'
settings pages.

---

### DATA-6 · Expired archive zips are swept from disk  `P1` ⏳

Export zips in `ARCHIVES_DIR` were never deleted — the download route flips a row
to `expired` + 410s but left the file, leaking disk. The worker now sweeps expired
zips (every reclaim tick + on each build + orphaned partials).

**Steps:**
1. Create an archive (DATA-3); note its zip under `ARCHIVES_DIR`.
2. Force-expire: `q "update \"ArchiveRequest\" set status='ready', \"expiresAt\"=now()-interval '1 day' where id='<id>'"`.
3. Wait one worker poll interval (or build another archive).

**Expected:** the `.zip` is unlinked; worker logs `archive-zips-swept` /
`archive-zip-removed`; a missing file never throws; row ends `expired`,
`downloadPath` null.

**Ground truth:** `ls "$ARCHIVES_DIR/<userId>/"` no longer lists the zip.

**Anchors:** `packages/db/src/archive.ts` (`sweepExpiredArchiveZips`),
`apps/worker/src/archive/run-archive.ts` (`sweepExpiredArchiveZipFiles`),
`apps/worker/src/index.ts` (`runReclaim`)
