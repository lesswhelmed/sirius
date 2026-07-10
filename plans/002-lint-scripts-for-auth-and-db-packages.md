# Plan 002: Add `lint` scripts to `packages/auth` and `packages/db`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 185d58f..HEAD -- packages/auth/package.json packages/db/package.json`
> If either changed since planning, compare the excerpts below to the live files
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED (the first lint run may surface real warnings that block the gate)
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `185d58f`, 2026-07-09

## Why this matters

`turbo run lint` only runs the `lint` task in packages that define it. `packages/auth`
(Better Auth config, trusted origins, session logic) and `packages/db` (query
builders, raw SQL in `search.ts`) — the two most security-sensitive packages —
have **no `lint` script**, so their source is silently skipped by the repo's
`--max-warnings 0` gate. Lint rules that catch real bugs (`no-floating-promises`,
`no-unused-vars`, etc.) never run there. This closes the gap so those packages are
covered like every other one.

## Current state

- `packages/auth/package.json` scripts — **no `lint`**:

```json
	"scripts": {
		"check-types": "tsc --noEmit"
	},
```

- `packages/db/package.json` scripts — **no `lint`**:

```json
	"scripts": {
		"db:generate": "prisma generate",
		...
		"check-types": "tsc --noEmit",
		"test": "bun test src/search.test.ts",
		"test:search": "bun test --preload ./test/setup-env.ts src/search.test.ts src/search.integration.test.ts"
	},
```

- **Exemplar to copy** — `packages/safety/package.json`:

```json
	"scripts": {
		"lint": "eslint . --max-warnings 0",
		"check-types": "tsc --noEmit",
		"test": "bun test"
	},
```

- `packages/embedding-scene/package.json` already has both the `lint` script and
  the devDeps that make it work: `"@repo/eslint-config": "*"` and `"eslint": "^9.39.1"`.
  Check whether `packages/auth` and `packages/db` already have those devDeps; if
  not, add them (see Step 2).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install` | exit 0 |
| Lint one package | `bun --cwd packages/auth run lint` / `bun --cwd packages/db run lint` | exit 0, no warnings |
| Lint everything | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `packages/auth/package.json` (add `lint` script; add eslint devDeps if missing)
- `packages/db/package.json` (add `lint` script; add eslint devDeps if missing)
- **Source fixes ONLY IF** the first lint run surfaces warnings — minimal, in
  `packages/auth/src/**` and `packages/db/src/**`, and only to clear real warnings.
- `packages/auth/eslint.config.*` / `packages/db/eslint.config.*` (create, only if
  absent and required — mirror `packages/safety`'s eslint config file).

**Out of scope**:
- Any behavior change. Lint fixes must be mechanical (unused imports, floating
  promises via `void`/`await`, etc.), never a logic change.
- Reconfiguring the shared `@repo/eslint-config`.
- Other packages' lint scripts.

## Git workflow

- Branch: `advisor/002-auth-db-lint`
- Commit only in-scope paths with explicit `git commit -- <paths>`. **Never
  `git add -A`** (shared swarm tree).
- Conventional-commit message, e.g. `chore(db,auth): add eslint lint scripts`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Add the `lint` script to both packages

Add `"lint": "eslint . --max-warnings 0"` to the `scripts` block of both
`packages/auth/package.json` and `packages/db/package.json`, matching the exemplar.

**Verify**: `grep '"lint"' packages/auth/package.json packages/db/package.json` →
both print the new line.

### Step 2: Ensure each package can resolve eslint + the shared config

Check `packages/safety/package.json`'s `devDependencies` for how it wires eslint
(it depends on `@repo/eslint-config` and `eslint`). If `packages/auth` or
`packages/db` lack these devDeps, add the same entries (`"@repo/eslint-config": "*"`,
`"eslint": "^9.39.1"`, and whatever eslint config file `packages/safety` uses — copy
its `eslint.config.*` file verbatim into the package if the package has none). Then
`bun install`.

**Verify**: `bun --cwd packages/auth run lint` and `bun --cwd packages/db run lint`
both **run** (they may report warnings — that's Step 3 — but they must not error with
"eslint: command not found" or "no config found").

### Step 3: Clear any surfaced warnings (minimal, mechanical)

Run each package's lint. If it reports warnings, fix them **minimally and
mechanically** in that package's `src/`. Typical fixes: prefix a deliberately
unawaited promise with `void`, remove an unused import/var, add a missing `await`.
If a warning would require a **logic** change to satisfy, STOP (see below).

**Verify**: `bun --cwd packages/auth run lint` → exit 0; `bun --cwd packages/db run lint`
→ exit 0.

### Step 4: Confirm the repo-wide gate is green

**Verify**: `bun run lint` → exit 0 (all packages, including the two newly-linted).
Then `bun run check-types` → exit 0 (confirm no fix in Step 3 broke types; run
`bun run db:generate` first if types don't resolve).

## Test plan

No new application tests. Verification is the lint + typecheck gates:
- `bun --cwd packages/auth run lint` → exit 0
- `bun --cwd packages/db run lint` → exit 0
- `bun run lint` → exit 0
- `bun run check-types` → exit 0

## Done criteria

ALL must hold:

- [ ] `packages/auth/package.json` and `packages/db/package.json` each have `"lint": "eslint . --max-warnings 0"`
- [ ] `bun --cwd packages/auth run lint` exits 0
- [ ] `bun --cwd packages/db run lint` exits 0
- [ ] `bun run lint` exits 0
- [ ] `bun run check-types` exits 0
- [ ] Any source edits are confined to `packages/auth/src/**` / `packages/db/src/**` and are mechanical (no logic change)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The first lint run surfaces a warning whose only fix is a **behavioral/logic**
  change (e.g. a genuinely floating promise on a critical path that needs real
  error handling, not just `void`). Report the file:line and the warning — the
  operator decides whether to fix the logic or disable the rule locally.
- Clearing warnings would touch more than ~10 files or anything outside
  `packages/auth`/`packages/db` — the scope is wrong; report back.
- eslint can't find a config for the package and `packages/safety`'s setup doesn't
  transfer cleanly — report what's different.

## Maintenance notes

- Once these are linted, any new floating-promise/unused-symbol in auth or db will
  fail CI (after plan 001 wires lint into CI — already wired today via `turbo lint`).
- A reviewer should scan the Step 3 fixes specifically for any accidental behavior
  change disguised as a lint fix (e.g. an `await` added that changes ordering).
