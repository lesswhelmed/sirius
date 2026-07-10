# Plan 012: SSRF-guard + size-cap the worker's cover/social image fetches

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- apps/worker/src/pipeline/post-writer.ts apps/worker/src/pipeline/safety/safe-fetch.ts apps/worker/src/pipeline/instagram/runner.ts apps/worker/src/pipeline/twitter/runner.ts`
> If any changed, re-read them before applying this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (additive validation; preserves the existing "fall back to remote URL on failure" behavior)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`localizeCoverImage` in `post-writer.ts` fetches a URL taken from **Gemini's
frontmatter output** (derived from user-submitted page content) with only a
`^https?://` scheme check, then writes the **full `arrayBuffer()`** to a **publicly
served** path (`public/social/<slug>.<ext>`). Two problems: (1) **SSRF** — a crafted
source page (or steered model) can point the cover URL at an internal/metadata
address (`169.254.169.254`, `localhost`, private ranges); the worker fetches it
server-side and persists the response bytes to a publicly reachable file, i.e.
potential internal-response exfiltration; (2) **memory-DoS** — no byte cap on a
model/attacker-chosen URL. The instagram/twitter `fetchImageBytes` cap size (8 MB)
but also lack the SSRF guard. The repo **already has** the exact SSRF machinery in
`safety/safe-fetch.ts` (`fetchGuardedPdf`) — this plan generalizes it to images and
routes all three image fetchers through it.

## Current state

- `apps/worker/src/pipeline/post-writer.ts` — `localizeCoverImage` (lines ~75–104):

```ts
async function localizeCoverImage(url: string | null, slug: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return url;
  }
  try {
    const res = await fetch(url);                         // <-- no SSRF guard
    if (!res.ok) { /* warn, return url */ }
    const ext = extFromContentType(res.headers.get("content-type")) ?? extFromUrl(url) ?? "jpg";
    const dir = resolveSocialDir(); ensureDir(dir);
    const dest = join(dir, `${slug}.${ext}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));  // <-- unbounded buffer, public path
    return `/social/${filename}`;
  } catch (err) { /* warn, return url (fallback to remote) */ }
}
```
  Called at `post-writer.ts:440` with `getImageUrl(parsed.frontmatter)` (model output).

- **The reuse target — `apps/worker/src/pipeline/safety/safe-fetch.ts`** already
  implements SSRF-hardened fetching for the PDF-by-link scan case:
  - `isBlockedIp(ip)` — rejects loopback / private / link-local (incl.
    `169.254.169.254`) / IPv6 ULA etc. (IPv4 + IPv6).
  - `resolveSafe(hostname)` — DNS-resolves and returns null if ANY answer is blocked
    ("any blocked → reject" defeats the public+private split trick).
  - `fetchGuardedPdf(...)` — validates scheme, resolves, **pins the IP** (connects to
    the resolved IP, not a re-resolved hostname, closing the TOCTOU/rebind window),
    and enforces a byte cap.
  Generalize this, don't reinvent it.

- `apps/worker/src/pipeline/instagram/runner.ts:40` and
  `apps/worker/src/pipeline/twitter/runner.ts:36` — each `fetchImageBytes` fetches
  then checks `buf.byteLength > MAX_IMAGE_BYTES` (8 MB) **after** buffering, and has
  no SSRF guard.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `bun run check-types` (run `bun run db:generate` first) | exit 0 |
| Lint | `bun --cwd apps/worker run lint` | exit 0 |
| Worker tests | `bun --cwd apps/worker test` | pass (incl. new safe-fetch tests) |
| Existing safe-fetch tests | `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts` | pass |

## Scope

**In scope**:
- `apps/worker/src/pipeline/safety/safe-fetch.ts` (add a guarded image fetch — e.g.
  `fetchGuardedImage(url, { maxBytes, allowedContentTypes })` — reusing
  `isBlockedIp`/`resolveSafe`/IP-pinning; or refactor the internals so PDF and image
  share the guard core)
- `apps/worker/src/pipeline/post-writer.ts` (`localizeCoverImage` uses it)
- `apps/worker/src/pipeline/instagram/runner.ts` and `.../twitter/runner.ts`
  (`fetchImageBytes` uses it)
- `apps/worker/src/pipeline/safety/safe-fetch.test.ts` (extend for the image path)

**Out of scope**:
- Changing the **fallback behavior**: on any guard rejection or fetch failure,
  `localizeCoverImage` must still return the original remote `url` (so the post keeps
  a cover, just not a localized copy). Do not turn a blocked fetch into a hard
  pipeline failure.
- `fetchGuardedPdf`'s existing PDF behavior — if you refactor a shared core, its
  behavior must be unchanged (its tests must still pass).
- Moving `safe-fetch.ts` out of the safety folder.

## Git workflow

- Branch: `advisor/012-ssrf-cover-image`
- Commit explicit paths only. **Never `git add -A`.**
- Message: `fix(security): SSRF-guard + size-cap worker image fetches`.

## Steps

### Step 1: Add a guarded image fetch to `safe-fetch.ts`

Add `fetchGuardedImage(url, opts)` (or refactor `fetchGuardedPdf` to share a private
`fetchGuarded(url, { maxBytes, contentTypeAllow })` core). It must:
1. Validate the URL parses and scheme is `http`/`https`.
2. `resolveSafe(hostname)` → reject (return null) if blocked.
3. Connect to the **pinned** resolved IP (as `fetchGuardedPdf` does), sending the
   original `Host` header, following redirects only after re-validating each hop's
   host through `resolveSafe` (or disallow redirects — match whatever
   `fetchGuardedPdf` does).
4. Enforce a streamed/again-checked byte cap (`maxBytes`, default 8 MB to match the
   existing image fetchers) — reject oversize without retaining the full body.
5. Enforce an image `content-type` allowlist (`image/jpeg|png|webp|gif|avif`), reject
   otherwise.
Return the bytes (`Buffer`/`Uint8Array`) on success, or null on any rejection.

**Verify**: `bun run check-types` → exit 0; `bun --cwd apps/worker run lint` → exit 0.

### Step 2: Route `localizeCoverImage` through it

Replace the raw `fetch(url)` + `arrayBuffer()` in `localizeCoverImage` with
`fetchGuardedImage(url, { maxBytes: 8MB })`. On null (blocked/oversize/wrong type/
failed), keep the current fallback: warn and `return url` (the remote URL). Derive
the extension from the guarded response's content-type as before.

**Verify**: `bun run check-types` → exit 0.

### Step 3: Route the instagram/twitter `fetchImageBytes` through it

Replace each `fetchImageBytes` body with a call to `fetchGuardedImage`, preserving
their existing 8 MB cap and their existing "return null → skip this image" behavior.

**Verify**: `bun --cwd apps/worker run lint` → exit 0; `bun run check-types` → exit 0.

### Step 4: Run the worker suite

**Verify**: `bun --cwd apps/worker test` → pass, including `fetchGuardedPdf`'s
existing tests (unchanged behavior) and the new image tests (Step 5).

## Test plan

- Extend `apps/worker/src/pipeline/safety/safe-fetch.test.ts` (the existing test for
  this module) to cover `fetchGuardedImage`:
  - a public host with an `image/png` content-type under the cap → returns bytes,
  - a blocked IP host (use `isBlockedIp`/`resolveSafe` seams as the existing tests
    do — mock the resolver to return `169.254.169.254` / `127.0.0.1`) → returns null,
  - an oversize body → returns null,
  - a non-image content-type → returns null.
  Follow the existing test's structure for how it stubs DNS/fetch.
- Verification: `bun --cwd apps/worker test src/pipeline/safety/safe-fetch.test.ts`
  → all pass, including the new image cases.

## Done criteria

- [ ] `safe-fetch.ts` exposes a guarded image fetch reusing `isBlockedIp`/`resolveSafe`/IP-pinning
- [ ] `localizeCoverImage`, and both `fetchImageBytes`, fetch through the guard
- [ ] Byte cap + image content-type allowlist enforced on all three
- [ ] `localizeCoverImage` still falls back to the remote URL on any rejection (no hard failure)
- [ ] `fetchGuardedPdf`'s existing behavior + tests unchanged
- [ ] `bun run check-types` and `bun --cwd apps/worker run lint` exit 0
- [ ] `bun --cwd apps/worker test` passes with new image guard tests
- [ ] `git status` shows only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `fetchGuardedPdf`'s internals can't be generalized without changing its behavior
  (its tests break) — report; prefer a parallel `fetchGuardedImage` over a risky
  shared refactor.
- The guard would reject legitimate public image CDNs (some resolve to Cloudflare/
  fastly ranges that are NOT private) — confirm `isBlockedIp` only blocks true
  private/loopback/link-local ranges (it does per the excerpt); if a public range is
  wrongly blocked, report before loosening.
- Redirect handling in the guarded fetch is ambiguous (image CDNs often 30x) —
  report how `fetchGuardedPdf` handles redirects and match it; do not silently allow
  un-revalidated redirect hops.

## Maintenance notes

- Now all three server-side user-influenced image fetches share one SSRF guard; any
  new server-side fetch of a user/model-supplied URL must go through it too.
- A reviewer should confirm IP **pinning** is preserved (connect to the resolved IP,
  not a re-resolved hostname) — that's what closes the DNS-rebind window.
- The `content-type` allowlist should stay in sync with the extensions
  `extFromContentType` understands in `post-writer.ts`.
