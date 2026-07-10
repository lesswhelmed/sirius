# Plan 001: CI runs the package test suites and a format check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- .github/workflows/ci.yml`
> If `ci.yml` changed since this plan was written, compare the "Current state"
> excerpt against the live file before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

CI currently runs only lint + typecheck + the pure-unit security suite. The real
per-package `test` scripts — `packages/db` (search ranking), `packages/safety`
(content-safety classifier), `packages/github-ingest`, `packages/ingest-classify`,
`apps/worker` (the ingest pipeline), `apps/mobile` — **never execute on push or
PR**. Regressions in those business-critical paths land on `main` green. There is
also no `prettier --check`, so formatting drift is caught only by whoever runs
`bun run format` locally. This plan makes a green CI run actually mean "the tested
packages pass," which is the gate that makes plans 013–015 (new test suites)
protective instead of decorative.

## Current state

- `.github/workflows/ci.yml` — the only CI workflow; one `check` job. Current
  steps (lines 27–44):

```yaml
      - name: Install dependencies
        run: bun install --frozen-lockfile

      # Prisma client is gitignored — must be generated before typecheck/build.
      - name: Generate Prisma client
        run: bun run db:generate

      - name: Lint + typecheck
        run: bunx turbo lint check-types

      # Pure-unit security regression suite (no DB required).
      - name: Security tests (unit)
        run: bun run test:security

      # TODO(follow-on): wire the DB-integration security tests
      # (`bun run test:security:db`). They require a live Postgres — add a
      # `services: postgres` block to this job and set `TEST_DATABASE_URL`
      # (plus run `bun run db:migrate:deploy` against it) before invoking.
```

- Root `package.json` scripts (already exist): `"test": "turbo run test"`,
  `"format": "prettier --write \"**/*.{ts,tsx,md}\""`, `"lint": "turbo run lint"`,
  `"check-types": "turbo run check-types"`.
- `turbo.json` defines a `test` task (`"test": { "dependsOn": ["^test"], "outputs": [] }`).
- **Important nuance**: some package `test` scripts are DB-integration suites gated
  on `TEST_DATABASE_URL`. `packages/db`'s default `"test": "bun test src/search.test.ts"`
  runs only the pure unit file (the integration files are a separate `test:search`
  script). Integration suites already **self-skip** when `TEST_DATABASE_URL` is
  unset (they use `RUN_DB ? describe : describe.skip`). So `turbo run test` without
  a Postgres service runs all the pure-unit suites and skips the DB ones — which is
  exactly the safe increment we want now. Wiring live Postgres is left as the
  existing `ci.yml` TODO (out of scope here).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Prisma client | `bun run db:generate` | exit 0 |
| Run all package tests locally | `bun run test` | exit 0, suites pass or self-skip |
| Format check | `bunx prettier --check "**/*.{ts,tsx,md}"` | exit 0 (or lists files to fix) |
| Validate the workflow YAML parses | `bunx --yes yaml-lint .github/workflows/ci.yml` OR just re-read it | no parse error |

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`

**Out of scope** (do NOT touch):
- Any package's `test` script or test files — this plan only wires CI to run what
  already exists. New tests are plans 013–015.
- Adding a `services: postgres` block / DB-integration CI — that's the existing
  `ci.yml` TODO, deliberately deferred.
- `package.json` scripts — the root `test`/`format` scripts already exist.

## Git workflow

- Branch: `advisor/001-ci-test-format`
- Commit only your in-scope path: `git commit -- .github/workflows/ci.yml`.
  **Do NOT `git add -A`** — this repo runs a multi-agent swarm sharing one working
  tree; a bare `git add`/commit sweeps up coworkers' staged files. Stage explicit
  paths only.
- Commit message style is conventional commits (see `git log`): e.g.
  `ci: run package test suites + prettier check on PR`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a "Package tests" step after the security-tests step

In `.github/workflows/ci.yml`, immediately after the `Security tests (unit)` step
(the `run: bun run test:security` step) and before the trailing TODO comment, add:

```yaml
      # Per-package unit test suites (turbo). DB-integration suites self-skip when
      # TEST_DATABASE_URL is unset (see the follow-on TODO below to wire Postgres).
      - name: Package tests
        run: bun run test
```

Leave the existing `TODO(follow-on)` comment in place — it still accurately
describes the deferred DB-integration work.

**Verify**: `bun run test` locally → exit 0 (integration suites print their
"TEST_DATABASE_URL unset — skipping" warning and skip; unit suites pass).

### Step 2: Add a format-check step

After the new "Package tests" step, add:

```yaml
      # Formatting is verified, not mutated, in CI (the `format` script is --write).
      - name: Format check
        run: bunx prettier --check "**/*.{ts,tsx,md}"
```

**Verify**: `bunx prettier --check "**/*.{ts,tsx,md}"` locally → exit 0. If it
lists unformatted files, that is a **pre-existing** formatting drift, not caused by
this plan — see STOP conditions.

### Step 3: Confirm the workflow still parses and the job is coherent

Re-read the whole `ci.yml` and confirm the two new steps sit inside the `check`
job's `steps:` list with correct indentation (6 spaces for the `- name:` items,
matching the existing steps).

**Verify**: `git diff .github/workflows/ci.yml` shows only the two added steps;
indentation matches the surrounding steps.

## Test plan

No application tests are added by this plan (it wires existing ones into CI). The
verification is that both new commands pass locally:

- `bun run test` → exit 0
- `bunx prettier --check "**/*.{ts,tsx,md}"` → exit 0

If `prettier --check` fails on pre-existing files, STOP (see below) — do not run
`--write` to "fix" it as part of this plan; that would sweep unrelated files into
your diff.

## Done criteria

ALL must hold:

- [ ] `.github/workflows/ci.yml` has a `Package tests` step running `bun run test`
- [ ] `.github/workflows/ci.yml` has a `Format check` step running `bunx prettier --check "**/*.{ts,tsx,md}"`
- [ ] `bun run test` exits 0 locally
- [ ] `bunx prettier --check "**/*.{ts,tsx,md}"` exits 0 locally
- [ ] `git status` shows only `.github/workflows/ci.yml` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `ci.yml` excerpt above doesn't match the live file (drift since planning).
- `bun run test` **fails** (not skips) locally — a package suite is actually
  broken. Report which suite and the output; do not silence it by editing tests.
- `prettier --check` reports pre-existing unformatted files. Report the file
  list. The operator decides whether to run a separate formatting sweep first
  (that must not be bundled into this CI plan's diff).
- Wiring the tests appears to require a live database to pass (an integration
  suite is NOT self-skipping as documented) — report which suite.

## Maintenance notes

- When the deferred DB-integration CI work is done (the existing `ci.yml` TODO),
  the `Package tests` step will start needing a `services: postgres` block +
  `TEST_DATABASE_URL` + `db:migrate:deploy`. Until then, integration suites skip.
- A reviewer should confirm the new steps run on both `push` and `pull_request`
  (they inherit the job's triggers) and that `bun run test` didn't silently pass
  because turbo found nothing to run.
- If a future package adds a DB-only `test` script with no self-skip guard, CI
  will start failing without Postgres — that package must follow the
  `RUN_DB ? describe : describe.skip` pattern (see
  `packages/db/src/ingest-retry-ownership.integration.test.ts:24-50`).
