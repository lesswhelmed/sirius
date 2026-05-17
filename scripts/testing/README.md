# scripts/testing — agent-browser end-to-end flows

Drive the live submission pipeline through a real browser before committing UI
work. These scripts validate **wiring** — request shapes, redirects, worker
pickup, post creation — not visuals. Style/layout changes should never make a
script fail; renames of buttons, fields, or routes should.

## Scripts

Each one does a single thing, prints what it learned to stdout, and exits
non-zero on failure.

| Script | Contract |
| --- | --- |
| `bootstrap-user.sh` | Ensure the configured `$TEST_EMAIL` user exists and is `emailVerified=true`. Idempotent. |
| `signin.sh` | Leave the shared browser session authenticated. No-op if already signed in. |
| `submit-url.sh <URL>` | Push one URL through the composer. Prints the new `IngestSubmission.id`. |
| `wait-completed.sh <id> [timeout_s]` | Block on DB polling until the row reaches a terminal state. Prints `completed:<slug>` or exits non-zero. |
| `verify-post.sh <slug>` | Assert the resulting Post is reachable via `/library` and `/posts/<slug>`. |
| `e2e.sh [URL]` | The five above, chained. |
| `teardown.sh [--delete-user]` | Close the browser; optionally drop the test user (FK-cascades). |

## Invariants

1. **One browser, many scripts.** Every script shares the agent-browser session
   named `$TEST_SESSION` (default `sirius`). `signin.sh` leaves cookies set;
   the rest inherit them. Run `teardown.sh` between independent runs.
2. **Creds live in a file, not in argv.** `.creds.local` is gitignored and
   sourced by `_lib.sh`. Adding a new credential? Add it to both
   `.creds.local` and `creds.example.sh`.
3. **The database is ground truth.** UI snapshots are for navigation and form
   filling only. Anything that needs an assertion (was a submission queued?
   did it complete? did a Post land?) goes through `psql_q` against the row —
   so a UI redesign doesn't break the tests.
4. **The worker must be running.** Submissions move `pending → processing →
   completed` because the worker daemon polls. `bun dev` from the repo root
   covers it; `wait-completed.sh` times out if the worker is dead.

## What's stable, what's fragile

The scripts try to depend on what changes least often.

- **Most stable:** the database schema (`packages/db/prisma/schema.prisma`),
  the public route shapes (`/ingest`, `/sign-in`, `/library`,
  `/posts/[slug]`), and DOM element IDs on auth forms.
- **Moderate:** ARIA attributes on long-lived inputs (e.g. the composer
  textarea's `aria-label`).
- **Fragile:** visible text on buttons. A button label rename is the typical
  thing that breaks a script.

When a script breaks because of a UI rename, fix it in one place — the script
itself. Don't add abstraction layers. The whole point is that each script is
short enough to read top-to-bottom.

## agent-browser locator preferences (in order)

This is the order the scripts try locators in, most-stable first:

1. CSS by ID — `#email`, `#password`. Form IDs only change when someone
   restructures the form, which is a deliberate change.
2. CSS by attribute — `textarea[aria-label="Content input"]`. Survives
   visual rewrites; breaks when the accessibility contract changes.
3. `agent-browser find text "..." click` for buttons. The `--exact` flag
   helps disambiguate when surrounding paragraphs share words.

What the scripts deliberately **avoid**:

- `agent-browser find role <role> --name "..."` — Playwright's accessible-name
  matching is stricter than the snapshot's display, and inputs with
  `aria-label` instead of an associated `<label>` element don't match.
- Snapshot `@eN` refs — they're regenerated every snapshot, so they're great
  for one-shot exploration but unstable across script invocations.
- `agent-browser wait --url <glob>` — fires on navigation events, not URL
  match. It hangs if the navigation already completed before the wait
  started. Use the `ab_wait_url <substring>` helper in `_lib.sh` instead.

## Extending

A new script is just bash plus `_lib.sh` helpers. The pattern:

```bash
#!/usr/bin/env bash
source "$(dirname "$0")/_lib.sh"
require_cmd agent-browser psql   # whatever the script needs

# ... use ab / ab_wait / ab_wait_url to drive the browser
# ... use psql_q "SELECT ..." for assertions
# ... log "transition" for human-readable progress
# ... exit non-zero on any failure
```

Helpers in `_lib.sh`:

| Helper | Use |
| --- | --- |
| `ab ...` | `agent-browser` wrapper bound to `$TEST_SESSION`. |
| `ab_wait ...` | `agent-browser`'s `wait` (element / text / load condition). |
| `ab_wait_url <sub> [timeout]` | Poll for a URL substring. Safe after navigation has already completed. |
| `psql_q "..."` | Query `DATABASE_URL` with the Prisma `schema=` param stripped. Tab-separated, no header. |
| `log "..."` | Timestamped output. |
| `require_cmd <bin>...` | Fail fast if a binary is missing. |

## Why `bootstrap-user.sh` flips `emailVerified` directly

Two reasons, both dev-mode:

- Better Auth (≥ 1.6) signs the email-verification token as a stateless JWT
  with `BETTER_AUTH_SECRET` and ships it only in the email body — there is
  no DB row to pull the token from.
- Resend in testing mode rejects sends to any address other than the
  verified sender, so the email never arrives.

Once `RESEND_FROM_EMAIL` points at a verified Resend domain (or a real SMTP
relay is wired up), the bootstrap can switch to clicking the actual
verification link.

## Prereqs

- `agent-browser` on `PATH` — `npm i -g agent-browser && agent-browser install`
- `psql` on `PATH`
- `bun dev` running from the repo root (web on `:3000` + worker)
- repo `.env` populated (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GEMINI_API_KEY`)
- `scripts/testing/.creds.local` created — copy `creds.example.sh` and fill in

## Usage

```bash
# one terminal — start the stack
bun dev

# another terminal
cp scripts/testing/creds.example.sh scripts/testing/.creds.local
$EDITOR scripts/testing/.creds.local
chmod +x scripts/testing/*.sh

scripts/testing/e2e.sh                            # default Wikipedia URL
scripts/testing/e2e.sh https://example.com/x      # custom URL
scripts/testing/teardown.sh                       # close browser when done
```
