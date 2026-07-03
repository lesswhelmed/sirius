# CP3 — Mobile capture & share intent (iOS)

The flagship mobile move: capture from anywhere (in-app Capture tab or the
native Share Sheet) with the **capture-loss invariant**: at every instant the
content exists either as a visible tray card or a durable outbox row — never
neither. Detailed sim automation lives in
[`scripts/testing/MOBILE-E2E.md`](../../scripts/testing/MOBILE-E2E.md); this doc
is the scenario contract.

> Last full pass: ⏳ · Prereqs: dev build of `dev.copt.sirius`, full stack via
> `bun run dev`, simulator autocorrect disabled (see MOBILE-E2E "One-time
> harness setup").

**Shared anchors:** `apps/mobile/src/app/(tabs)/composer.tsx`,
`apps/mobile/src/lib/materials.ts`, `apps/mobile/src/app/shareintent.tsx`,
`apps/mobile/src/app/+native-intent.ts`, `apps/mobile/src/lib/outbox.ts`

---

### MOB-1 · Capture tab: URL + note end to end  `P0` ⏳

**Steps:**
1. Capture tab → paste a URL → submit.
2. Capture tab → type a note → submit.
3. Watch the Queue tab until both complete; open each resulting post from the
   Catalog tab.

**Expected:**
- Both submissions hit `/api/app/ingest` session-authed and appear in the
  Queue tab as `pending → processing → completed`.
- URL → FINDING post, note → BLOG post (worker forces the type).
- The multiline keyboard shows the custom Done accessory (iOS ignores
  `inputAccessoryViewID` on multiline inputs — regression memory).

**Ground truth:** same psql checks as [ING-1/ING-2](CP2-capture-ingest.md).

**Anchors:** + `apps/mobile/src/components/sirius.tsx` (KeyboardDoneButton)

---

### MOB-2 · iOS Share Sheet ingest (cold + warm)  `P0` ⏳

**Steps:**
1. **Cold:** kill the app. In Safari, share a URL → Sirius. App opens on the
   share screen; confirm the capture.
2. **Warm:** with the app already running (backgrounded), share another URL.
3. Share the **same** URL again (dedup path).
4. While the share pane is open, background it mid-edit with a note typed,
   return, and finish.

**Expected:**
- Exactly **one** share screen per share — no double-push (single-navigator
  rule: only `+native-intent` redirects) and no spurious "Nothing shared".
- Both cold and warm shares produce a submission; warm shares survive the
  auth grace period (401-safe outbox, commit a5d4bb0 groundwork).
- Duplicate share is surfaced as already-captured with "Process again" — not a
  fake success (memory: *share dedup silent success*).
- The typed note is **not** lost on backgrounding
  (`resetOnBackground: false` — memory: *crash capture + share backgrounding*).

**Ground truth:** `IngestSubmission` row per accepted share;
`q "select count(*) …"` before/after the dedup step.

**Anchors:** + `apps/mobile/src/lib/omni-ingest.ts`,
`apps/mobile/src/lib/outbox.ts`, `apps/mobile/src/lib/outbox-task.ts`

---

### MOB-3 · Outbox durability: offline & failed sends  `P0` ⏳

The capture-loss invariant under network failure. True offline can't be faked
on the simulator behind portless (memory: *offline sim test blocked*) — test
this on a **physical device with airplane mode**, or by stopping the web app
with the proxy down.

**Steps:**
1. Go offline (airplane mode).
2. Capture a note and share a URL from Safari's reading list.
3. Observe the Capture tab's **In-flight** section.
4. Go back online; let the outbox drain (or trigger retry).
5. Force-quit the app while an item is still pending-send, relaunch.

**Expected:**
- Offline captures land in the durable outbox (In-flight section) — never
  silently dropped; enqueue-time throws push to a visible `failed` state.
- After reconnect, items send and move to the server queue.
- Outbox rows survive force-quit/relaunch (durability = disk, not memory).

**Anchors:** `apps/mobile/src/lib/materials.ts`,
`apps/mobile/src/lib/outbox.ts`, `apps/mobile/src/lib/outbox-task.ts`,
`apps/mobile/src/app/(tabs)/composer.tsx` (In-flight section)

---

### MOB-4 · Deep links & tab routing  `P1` ⏳

Route map is canonical in
[`apps/mobile/docs/ROUTES.md`](../../apps/mobile/docs/ROUTES.md) — consult it
before adding cases. Scheme is `siriusapp://` (the bundle id is **not** a
scheme).

**Steps (via `xcrun simctl openurl booted <url>`):**
1. `siriusapp://composer`, `siriusapp://library`, `siriusapp://feed`,
   `siriusapp://tree`, `siriusapp://queue`, `siriusapp://settings`
2. `siriusapp://post/<slug>` for an owned post.

**Expected:** each link lands on the right screen; tab labels differ from
route names by design (Friends = `feed`, Explore = `tree`) — the *label* is
not the contract, the route is. No `siriusapp://explore` route exists.

**Anchors:** `apps/mobile/src/app/(tabs)/_layout.tsx`,
`apps/mobile/docs/ROUTES.md`

---

### MOB-5 · First-run onboarding gate  `P2` ⏳

**Steps:** fresh install (or clear the `sirius.onboarding.seen` SecureStore
flag) → launch → complete/skip onboarding → relaunch.

**Expected:** first launch redirects once into the `/help` "How Sirius works"
hub; subsequent launches go straight to the app. Help remains reachable from
Capture and Account.

**Anchors:** `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/help.tsx`,
`apps/mobile/src/lib/onboarding.ts`

---

### MOB-6 · Offline mirror: catalog reads without network  `P1` ⏳

**Steps:** with a synced account, enable airplane mode; browse the Catalog
tab and open a post.

**Expected:** owned posts render from the local SQLite mirror (text-only is
acceptable — phase 1); live-only surfaces (Queue, corpus search) degrade with
an explicit offline/error state, not a spinner forever or a crash.

**Anchors:** `apps/mobile/src/lib/db` (expo-sqlite + drizzle store),
`apps/mobile/src/components/corpus-search.tsx` (online-only)
