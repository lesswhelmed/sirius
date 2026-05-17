# scripts/testing — agent-browser end-to-end flows

Shell scripts that drive the sirius-2-simple submission pipeline through a
real browser via [agent-browser](https://github.com/anthropics/agent-browser).
Mirrors the manual run captured in plan
`~/.claude/plans/1-agent-browser-next-devtools-mcp-modular-dongarra.md`.

## Setup

```bash
cp scripts/testing/creds.example.sh scripts/testing/.creds.local
$EDITOR scripts/testing/.creds.local        # set TEST_EMAIL, TEST_PASSWORD, TEST_NAME
chmod +x scripts/testing/*.sh
```

`.creds.local` is gitignored. Repo `.env` must have `DATABASE_URL` populated;
scripts source it automatically.

Prereqs: `agent-browser` (`npm i -g agent-browser && agent-browser install`),
`psql`, a running `bun dev` from the repo root.

## Scripts

| Script | Purpose |
| --- | --- |
| `bootstrap-user.sh` | Idempotent: create the test user via `/sign-up` if missing, then `UPDATE emailVerified=true` directly (Resend testing mode rejects sends to unverified recipients, so the email-link path is unreliable in dev). |
| `signin.sh` | Sign in as the test user. Leaves the session authenticated and parked on `/ingest`. |
| `submit-url.sh <URL>` | Submit one URL through the composer. Prints the new `IngestSubmission.id`. |
| `wait-completed.sh <id> [timeout_s=120]` | Poll the DB until the submission reaches a terminal state. Prints `completed:<slug>` on success; exits non-zero on `failed`, `skipped`, or timeout. |
| `verify-post.sh <slug>` | Assert the resulting Post shows up in `/library` and that `/posts/<slug>` renders. |
| `e2e.sh [URL]` | Chains the four above. Defaults to a stable Wikipedia URL. |
| `teardown.sh [--delete-user]` | Close the agent-browser session; `--delete-user` also drops the test user (cascades). |

## Conventions

- All scripts share one agent-browser session named via `$TEST_SESSION`
  (default `sirius`). Cookies and tabs persist across script invocations
  until `teardown.sh` runs.
- `_lib.sh` strips Prisma's `schema=public` query param so `psql` accepts
  `DATABASE_URL`.
- Bash with `set -euo pipefail` — first failure aborts.

## Typical loop

```bash
# one terminal
bun dev

# another terminal
scripts/testing/e2e.sh                                # full flow, default URL
scripts/testing/e2e.sh https://example.com/article    # custom URL
scripts/testing/teardown.sh                           # close browser when done
```

## Known constraint

The `bootstrap-user.sh` flow flips `emailVerified=true` via a direct UPDATE
because Better Auth v1.6.11 signs verification tokens with `BETTER_AUTH_SECRET`
into a stateless JWT in the email URL — there is no DB row to recover the
token from, and Resend's testing mode only accepts sends to the verified
sender address. Once `RESEND_FROM_EMAIL` points at a verified domain (or you
configure a real SMTP relay), `bootstrap-user.sh` can switch to clicking the
real verification link instead.
