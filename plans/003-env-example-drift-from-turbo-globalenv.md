# Plan 003: Backfill `.env.example` from `turbo.json` globalEnv

> **Executor instructions**: Follow step by step; verify each step. On any STOP
> condition, stop and report. Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- .env.example turbo.json`
> If either changed, re-derive the missing-var set (Step 1) against the live files.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`turbo.json`'s `globalEnv` is the authoritative list of env vars the build/runtime
reads. `.env.example` — the onboarding template — has drifted from it: ~16 declared
vars are undocumented, including **functional toggles** (`OCR_ENABLED`,
`REFLECTION_ENABLED`), ingest tuning (`INGEST_LEASE_MS`, `INGEST_MAX_ATTEMPTS`,
rate-limit knobs), and alternate API-key names the code accepts
(`GOOGLE_GENAI_API_KEY`, `APIFY_API_TOKEN`). A new contributor copying `.env.example`
gets a silently-misconfigured worker, and the failures surface deep in the pipeline
at runtime rather than at startup. This closes the drift and (optionally) adds a
guard so it can't reopen.

## Current state

- `.env.example` (repo root) is grouped by subsystem with a comment above each var.
  Header format to match:

```
# --- Database ---
DATABASE_URL=postgresql://user:password@localhost:5432/sirius

# --- Auth (Better Auth) ---
# ...comment...
BETTER_AUTH_SECRET=replace_me_with_a_32_char_secret
```

- `turbo.json` has a `globalEnv` array (~76 entries) that is the source of truth.
- These are DIFFERENT sets today; the concrete work is to add the missing keys to
  `.env.example` with a short comment + safe placeholder each.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| List globalEnv keys | `node -e "console.log(require('./turbo.json').globalEnv.join('\n'))" \| sort > /tmp/globalenv.txt` | file of keys |
| List documented keys | `grep -oE '^[A-Z_][A-Z0-9_]*=' .env.example \| sed 's/=$//' \| sort > /tmp/example.txt` | file of keys |
| Compute the gap | `comm -23 /tmp/globalenv.txt /tmp/example.txt` | the vars to add |
| Validate nothing broke | `bun run check-types` | exit 0 |

## Scope

**In scope**:
- `.env.example` (add the missing keys, grouped, with comments + placeholders)
- OPTIONAL: `scripts/check-env-example.mjs` (a small guard script) + a root
  `package.json` script `"check:env-example"` wiring it — only if you also do the
  guard in Step 3.

**Out of scope**:
- `.env` / `.env.production` (real env files — gitignored; never touch).
- `turbo.json` globalEnv (it is the source of truth; don't trim it to match).
- Committing any real secret value — `.env.example` holds placeholders only.

## Git workflow

- Branch: `advisor/003-env-example`
- Commit explicit paths only (`git commit -- .env.example [scripts/check-env-example.mjs package.json]`).
  **Never `git add -A`.**
- Message: `docs(env): backfill .env.example from turbo globalEnv`.

## Steps

### Step 1: Derive the exact set of undocumented vars

Run the three commands above to produce the `comm -23` output — the vars present in
`globalEnv` but absent from `.env.example`. This is the authoritative to-add list
(do not rely on any list from memory; derive it fresh).

**Verify**: the `comm -23` output is non-empty and each entry is a real var name
(all-caps). Expect ~16 entries including `OCR_ENABLED`, `REFLECTION_ENABLED`,
`REFLECTION_MODEL`, `GEMINI_OBJECT_MAX_ATTEMPTS`, `INGEST_MAX_ATTEMPTS`,
`INGEST_LEASE_MS`, `INGEST_RL_PER_MAX`, `INGEST_RL_GLOBAL_MAX`,
`BEARER_AI_WINDOW_MAX`, `BEARER_AI_WINDOW_MS`, `GOOGLE_API_KEY`,
`GOOGLE_GENAI_API_KEY`, `APIFY_API_TOKEN`, `MCP_PORT`, `BUILD_DIR`, `NODE_ENV`.

### Step 2: Add each missing var to the right subsystem group

For every var from Step 1, add a line to `.env.example` under the appropriate
`# --- Group ---` heading (create a group if none fits), with:
- a one-line comment describing what it does + whether it's required or optional,
- a safe placeholder value (empty for secrets/keys, the code's default for tuning
  knobs, `false`/`true` for toggles at their default).

To find each var's meaning and default, `grep -rn "process.env.<VAR>" apps packages`
and read the surrounding default (e.g. `INGEST_LEASE_MS` default is in
`apps/worker/src/index.ts`; `REFLECTION_ENABLED` gates the reflection stage). For
alternate-name keys (`GOOGLE_GENAI_API_KEY`, `APIFY_API_TOKEN`, `GOOGLE_API_KEY`),
note in the comment that they are alternates for the primary key already documented
(`GEMINI_API_KEY`, `APIFY_TOKEN`).

Do NOT put real values. `NODE_ENV`/`BUILD_DIR` are infra — document them briefly
(e.g. `NODE_ENV=development`) and note they're usually set by the platform.

**Verify**: re-run the Step 1 `comm -23` — output is now **empty** (every globalEnv
key is documented).

### Step 3 (optional but recommended): Add a drift guard

Create `scripts/check-env-example.mjs` that reads `turbo.json` globalEnv and the
`.env.example` keys and exits non-zero listing any globalEnv key missing from
`.env.example` (the same `comm -23` logic in JS). Add root script
`"check:env-example": "node scripts/check-env-example.mjs"`. (Wiring it into CI is a
follow-up, not required here.)

**Verify**: `bun run check:env-example` → exit 0.

## Test plan

No application tests. Verification:
- Step 2 `comm -23` returns empty.
- `bun run check-types` → exit 0 (sanity; no code touched, should be trivially green).
- If Step 3 done: `bun run check:env-example` → exit 0.

## Done criteria

- [ ] Every `turbo.json` globalEnv key appears in `.env.example` (`comm -23` empty)
- [ ] Each added var has a comment + a non-secret placeholder
- [ ] No real secret value anywhere in `.env.example`
- [ ] `git status` shows only `.env.example` (and the optional guard files)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- A globalEnv var has no `process.env.<VAR>` reference anywhere in `apps`/`packages`
  (it may be dead config in `turbo.json` — report it rather than documenting a
  no-op var).
- You cannot determine a var's safe default/placeholder from the code — list those
  vars and ask, rather than guessing a value that could mislead.

## Maintenance notes

- If Step 3's guard is added, wire `bun run check:env-example` into
  `.github/workflows/ci.yml` in a later change so drift can't reopen.
- Whenever a new var is added to `turbo.json` globalEnv (the CLAUDE.md contract for
  build-cache-invalidating vars), it must also be added to `.env.example`.
