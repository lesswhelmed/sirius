# QA — Critical-path test scenarios

Living manual-test documentation for Sirius (web + worker + mobile). These docs
describe **what must never break** and exactly how to verify it. They complement
— not duplicate — the automation that already exists:

- Web browser E2E scripts: [`scripts/testing/README.md`](../../scripts/testing/README.md)
- Mobile (iOS Simulator) E2E runbook: [`scripts/testing/MOBILE-E2E.md`](../../scripts/testing/MOBILE-E2E.md)
- Deterministic search harness: `packages/db` `db:test:setup` + `test:search` (see [`docs/search-ranking.md`](../search-ranking.md))
- Cross-user data-scoping audit: `scripts/testing/scoping-audit.sh` (see [`docs/SECURITY-data-scoping.md`](../SECURITY-data-scoping.md))

Where a scenario is already covered by a script, the scenario says so and links
it — run the script instead of clicking through.

## The critical paths

| Doc | Covers | Why it's critical |
| --- | --- | --- |
| [CP1 — Auth & account lifecycle](CP1-auth-account.md) | Sign-up + Terms, email verification, sign-in, password reset, handle setup, terms gate, sign-out, account deletion | Nobody gets into (or safely out of) the product without it |
| [CP2 — Capture & ingest pipeline](CP2-capture-ingest.md) | Web composer (URL / note / images), dedup, queue states, worker drafting, post creation, retained originals | The core product loop |
| [CP3 — Mobile capture & share intent](CP3-mobile-capture.md) | Capture tab, iOS Share Sheet ingest, outbox durability, offline behavior, deep links | The flagship mobile move; capture loss = broken promise |
| [CP4 — Friends, sharing & visibility](CP4-friends-visibility.md) | Friend requests, PRIVATE/FRIENDS/GROUP/PUBLIC audiences, merged feed, privacy invariants | Privacy bugs are unshippable |
| [CP5 — Moderation & safety](CP5-moderation-safety.md) | Report post, block/unblock, blocked-content exclusion, Terms gate, report SLA tooling, worker safety guardrails | App Store Guideline 1.2 compliance; trust & safety |
| [CP6 — Search, catalog & explore](CP6-search-explore.md) | Curated search (web + mobile), match badges, degraded mode, Observatory/Tree scene | Retrieval is how users get value back out |
| [CP7 — Data ownership & export](CP7-data-ownership.md) | Post detail, source originals, notes, archive export email flow, post deletion cleanup | Retention/export promises; owner-only access |

## Scenario format (contract)

Every scenario follows this shape — keep it when adding new ones:

```markdown
### XX-N · Short name  `P0|P1|P2`
**Preconditions:** what must be true before you start.
**Steps:** numbered, one action per line.
**Expected:** observable results, bulleted.
**Ground truth:** (optional) the psql/curl assertion that survives UI redesigns.
**Anchors:** the code files this scenario exercises.
```

- **P0** — release-blocking. Run before every store submission / production deploy.
- **P1** — run when the touched area's anchors changed, and in the weekly full pass.
- **P2** — nice-to-verify; run when directly affected.

Status legend used inside docs: ✅ verified live · ◑ partially verified · ⏳ not yet run.

## Ground truth is the database

Same philosophy as the E2E suites: UI is for navigation; **assertions go
against the DB or the API response**, so a redesign never invalidates a
scenario. Standard psql helper (from repo root):

```sh
set -a; source .env; set +a
PSQL_URL="${DATABASE_URL%%\?*}"      # strip ?schema= for psql
q(){ psql "$PSQL_URL" -tAc "$1"; }
```

## Environment setup

Full-stack dev (web at `https://sirius.local`, worker daemon, Metro, booted
iOS Simulator):

```sh
bun run dev        # run interactively (`! bun run dev`) — portless :443 needs sudo;
                   # backgrounded it silently falls back to :1355 and breaks auth
```

- The **worker must be running** for any ingest scenario — submissions only
  move `pending → processing → completed` because the worker polls.
- Dev sign-in: `saleebmina@icloud.com` + `DEV_LOGIN_PASSWORD` from root `.env`.
- Scripted test users: `scripts/testing/bootstrap-user.sh` (idempotent, marks
  `emailVerified=true`); teardown with `teardown.sh --delete-user`.
- Friend/visibility scenarios need **two** users — `TEST_EMAIL_B` /
  `TEST_PASSWORD_B` in `scripts/testing/.creds.local`, or seed a populated
  friend network via `bun scripts/create-reviewer-account.ts`.
- Mobile scenarios: install the dev build of `dev.copt.sirius`; deep-link
  scheme is `siriusapp://` (route map: [`apps/mobile/docs/ROUTES.md`](../../apps/mobile/docs/ROUTES.md)).
  **Disable simulator keyboard autocorrect first** — see the "One-time harness
  setup" section of `MOBILE-E2E.md`, or every typed URL gets silently corrupted.

## Keeping these documents alive (maintenance contract)

These docs rot the moment they're wrong, so the rules are mechanical:

1. **Anchors are the sync mechanism.** Every scenario lists the source files it
   exercises. Before changing behavior in a file, check whether it's an anchor:

   ```sh
   grep -rn "path/of/file/you/changed" docs/qa/
   ```

   If it is, update the affected scenarios **in the same PR**. A scenario whose
   anchor changed but whose steps didn't get re-read is presumed stale.
2. **IDs are permanent.** Never renumber or reuse a scenario ID (`AUTH-3`,
   `ING-5`, …). Retired scenarios get struck through with a one-line reason,
   not deleted — the ID may be referenced from bug reports and beads.
3. **Stamp verification.** When you run a scenario against a real build, update
   its status marker (✅/◑/⏳) and the doc's `Last full pass` line. Don't mark
   ✅ from reading code — only from running it (see the
   `always-execute-validation` house rule).
4. **New feature ⇒ new scenarios in the feature PR**, at the priority the
   failure mode deserves (privacy/data-loss ⇒ P0). A feature without a QA
   scenario is invisible to the release pass.
5. **Prefer ground-truth over pixel assertions.** If you find yourself writing
   "the button is blue", stop — write what row/response must exist instead.
6. **Don't fork the knowledge.** If a behavior is already specified in a design
   doc (`docs/friends-feed.md`, `docs/search-ranking.md`,
   `docs/safety-guardrails.md`), link it; scenarios here describe *how to
   verify*, not *how it works*.

## Release pass checklist

Before a store submission or production deploy, run every **P0** scenario:

- [ ] CP1: AUTH-1, AUTH-3, AUTH-5, AUTH-7, AUTH-8
- [ ] CP2: ING-1, ING-2, ING-4, ING-6
- [ ] CP3: MOB-1, MOB-2, MOB-3
- [ ] CP4: VIS-1, VIS-2, VIS-4, VIS-6
- [ ] CP5: MOD-1, MOD-2, MOD-3, MOD-6
- [ ] CP6: SRCH-1, SRCH-3
- [ ] CP7: DATA-1, DATA-3, DATA-4
- [ ] `scripts/testing/e2e.sh` green
- [ ] `scripts/testing/scoping-audit.sh` green
- [ ] `packages/db` search suite green (`test:search`)
