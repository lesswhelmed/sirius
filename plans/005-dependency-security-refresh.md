# Plan 005: Security dependency refresh — clear runtime-reachable advisories

> **Executor instructions**: Follow step by step; verify each step with `bun audit`
> and the typecheck/test gates. On any STOP condition, stop and report. Update this
> plan's row in `plans/README.md` when done. This plan changes dependency versions —
> re-run the app's verification gates after every bump.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- bun.lock package.json apps/*/package.json packages/*/package.json` — if the lockfile moved a lot, re-run `bun audit` to get the current advisory set before following the steps.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW (transitive patch bumps) to MED (a `streamdown` bump can shift markdown rendering)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`bun audit` reports **1 critical + 4 high + 15 moderate** advisories. Two of the
highs are **worker-runtime-reachable**:
- `form-data <4.0.6` (CRLF injection, GHSA-hmw2-7cc7-3qxx) via
  `apify-client` — driven on every Instagram/Twitter social ingest
  (`apps/worker/src/pipeline/twitter/apify.ts`).
- `ws <8.21.0` (memory-exhaustion DoS) via `@google/genai` — the worker's Gemini
  embedding/image client.

Plus `dompurify <=3.4.6` (XSS sanitizer-bypass) via `streamdown`, which renders
**AI/user-derived post markdown** in the browser (`apps/web/app/(app)/posts/[slug]/page.tsx:259`,
`post-editor.tsx:204`) — the app's primary untrusted-HTML sink. Keeping the
sanitizer current is defensive maintenance on the exact place untrusted content
reaches the DOM. This plan clears what can be cleared by a lockfile refresh and
scopes the render-sensitive ones honestly.

## Current state

- Run `bun audit` to see the live set. At planning time it reported (abridged):
  - `high: form-data` — path `workspace:worker › apify-client`
  - `high: ws: Memory exhaustion DoS` — path `workspace:worker › @google/genai`
  - `high: hono: CORS reflects any Origin with credentials (wildcard default)` —
    path via `workspace:mcp › @modelcontextprotocol/sdk` and `@repo/db › prisma`
  - `high: esbuild <=0.24.2` — path `workspace:mobile › drizzle-kit` (dev/build tool)
  - `critical: shell-quote` — path `workspace:mobile › react-native` (build tooling)
  - `moderate: dompurify <=3.4.6` (XSS) — path `workspace:web › streamdown`
  - moderate: `postcss <8.5.10`, `@hono/node-server` serveStatic bypass,
    `js-yaml <3.15.0` (via `worker › gray-matter`)
- Dependency declarations: `apify-client` and `@google/genai` are direct deps of
  `apps/worker/package.json`; `streamdown` is a direct dep of `apps/web/package.json`.
  Root `package.json` has an `overrides` block already used to pin transitives —
  this is the mechanism to force a fixed transitive version if a plain update won't.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Current advisories | `bun audit` | the list; note counts |
| High/critical only | `bun audit \| grep -iE "high\|critical"` | the reachable set |
| Refresh compatible versions | `bun update` | lockfile updates, exit 0 |
| Typecheck | `bun run db:generate && bun run check-types` | exit 0 |
| Worker tests | `bun --cwd apps/worker test` | pass |
| Web build sanity (do NOT commit artifacts) | `bun --cwd apps/web run check-types` | exit 0 |

## Scope

**In scope**:
- `bun.lock` (via `bun update` / targeted updates)
- root `package.json` `overrides` (to force a fixed transitive version where a plain
  update won't reach it — e.g. `"form-data": ">=4.0.6"`, `"ws": ">=8.21.0"`)
- `apps/web/package.json` `streamdown` version (only if the moderate `dompurify`
  advisory requires a `streamdown` bump — Step 4, render-check gated)

**Out of scope**:
- Bumping `react-native` to clear the `shell-quote` critical — that's a build-tool
  dep on a large upgrade; INVESTIGATE only (Step 5), do not bump RN here.
- Any application code change. If a bump forces code changes to compile, that bump
  is out of scope for this plan — report it.
- `@modelcontextprotocol/sdk` / `prisma` major bumps to chase the `hono` advisory
  if a plain update doesn't resolve it (Step 3 handles the reachable-vs-not call).

## Git workflow

- Branch: `advisor/005-dep-security-refresh`
- Commit explicit paths only (`git commit -- bun.lock package.json apps/web/package.json`).
  **Never `git add -A`.**
- Message: `chore(security): refresh deps to clear form-data/ws/dompurify advisories`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Snapshot the advisory set

Run `bun audit` and save the high/critical list. This is your before/after baseline.

**Verify**: you have a recorded list of high+critical advisories and their dep paths.

### Step 2: Clear the runtime-reachable highs (`form-data`, `ws`) via a targeted refresh

Run `bun update`. Then re-run `bun audit`. If `form-data` and/or `ws` still show as
vulnerable (a transitive pinned by a parent that hasn't moved), add explicit
`overrides` in root `package.json`:
`"form-data": ">=4.0.6"` and `"ws": ">=8.21.0"`, then `bun install`.

**Verify**: `bun audit | grep -iE "form-data|ws:"` → no longer reports the high
advisory. Then `bun run db:generate && bun run check-types` → exit 0, and
`bun --cwd apps/worker test` → pass (the worker uses both packages).

### Step 3: Address `hono` CORS + the moderate transitives where safe

Re-run `bun audit`. For `hono`, `postcss`, `@hono/node-server`, `js-yaml`: if
`bun update` (Step 2) already cleared them, done. If `hono` persists via the MCP
SDK / prisma and only clears with a **major** bump of those parents, do NOT force
it — record it as reachable-vs-not analysis: the `hono` CORS advisory only bites if
the app configures a wildcard CORS origin **with credentials**; check whether
`apps/mcp` does (`grep -rn "cors\|Origin" apps/mcp/src`). If MCP does not use hono's
CORS middleware with a wildcard+credentials config, note the advisory as
not-reachable and leave it for a future SDK bump.

**Verify**: `bun audit` high count is reduced to only the deferred items (documented
in your report); `bun run check-types` → exit 0.

### Step 4: `dompurify`/`streamdown` XSS — bump only with a render check

The `dompurify` advisory is on the LLM-markdown render path. Check whether a
`streamdown` version exists that resolves to `dompurify >=3.4.7`. If a **patch/minor**
`streamdown` bump reaches it, bump `apps/web/package.json` `streamdown`, `bun install`,
and verify `bun --cwd apps/web run check-types` → exit 0. If only a **major**
`streamdown` bump reaches it (markdown rendering may change), do NOT bump blindly —
STOP and report that a streamdown major is required, because it needs a manual
render check of `posts/[slug]/page.tsx` and the editor preview before merge.

**Verify**: `bun audit | grep -i dompurify` cleared (if bumped) OR a STOP report
explaining the required streamdown major.

### Step 5: Investigate (do not fix) the build-tool advisories

`shell-quote` (via `react-native`) and `esbuild` (via `drizzle-kit`) are on
**build/dev tooling**, not runtime request paths. Confirm they're build-only
(`bun audit` dep paths show `react-native`/`drizzle-kit`) and record them in your
report as deferred-with-rationale (bumping RN/drizzle-kit is a separate,
higher-risk change). Do not attempt them here.

**Verify**: your report lists shell-quote + esbuild as build-only, deferred.

## Test plan

No new application tests. Verification is `bun audit` deltas + the existing gates:
- `bun audit` — the two runtime-reachable highs (`form-data`, `ws`) are cleared
- `bun run check-types` → exit 0
- `bun --cwd apps/worker test` → pass (worker exercises form-data/ws paths)
- `bun --cwd apps/web run check-types` → exit 0 (if streamdown touched)

## Done criteria

- [ ] `bun audit` no longer reports the `form-data` and `ws` high advisories
- [ ] `bun run check-types` exits 0
- [ ] `bun --cwd apps/worker test` passes
- [ ] `dompurify` advisory cleared OR a STOP report explains the required streamdown major
- [ ] Report documents which advisories were deferred and why (shell-quote, esbuild, any hono/SDK)
- [ ] Only dependency/lockfile files changed (no app code)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Clearing an advisory requires an application **code** change to compile/pass tests
  (the bump has a breaking API change) — report the package + the break.
- The `dompurify` fix requires a `streamdown` **major** version — report it for a
  gated render-check change (do not merge a markdown-renderer major behind an audit
  fix).
- `bun update` regresses `bun --cwd apps/worker test` or typecheck — report which
  package moved and the failure; do not pin-and-pray.
- `bun audit` at execution time differs materially from the Current-state list
  (advisories change over time) — report the new set and proceed on the same
  principle (clear runtime-reachable highs first).

## Maintenance notes

- After plan 001 lands, consider adding `bun audit --prod` (or a scheduled audit) to
  CI so new high advisories on runtime deps surface automatically.
- A committed secret is not involved here (no secret exposure was found), so no
  rotation is needed — this is purely a version refresh.
- The `streamdown`/`dompurify` sink is the one to watch: any future streamdown bump
  should be render-checked against a post body containing rich/edge-case markdown.
