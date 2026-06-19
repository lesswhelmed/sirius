# MISSION: harden + production-validate the mobile offline-sync WIP

You are a cold agent. Everything you need is below. Work in
`/Users/minasaleeb/workspaces/sirius-2-simple` (bun monorepo; read
CLAUDE.md first).
OBEY the owner's global rules: never ship code or run a prod
deploy/OTA/rollback
without explicit go-ahead; if you find a failure, say so and propose a
fix — don't
silently work around it; DON'T ASSUME — ASK.

## What just shipped (the thing under test)

An EAS OTA was published to the **production** branch from commit
`f322e46`
(branch `fix/ingest-orphan-categories`). It carries TWO things:

1. The intended fix: `bfec6c4` "honor parentPath so the Tree category
   outline renders."
2. **Unfinished offline-first sync WIP** (the real risk) — pushed
   deliberately by the owner.

OTA identifiers (for EAS dashboard / rollback):

- iOS update group `c67c3dff-af3b-4a71-845a-bbe10ac8616d`, runtime
  `a371f5d3…` (== prod build #17, id
  `6896fefd-3cd1-4a71-8576-c177054ac17c`).
- Android update group `1d056a23-92b6-4458-935f-96fbde64bff1`, runtime
  `c52069e8…`.
- Prod server is deployed at `bfec6c4` (`lesswhelmed.com`). Dev server is
  `https://sirius.local` (run `bun run dev` interactively for :443; see
  memory `portless-443-sudo-fallback`).

## The WIP you must validate (apps/mobile, ~753 lines)

Offline-first post store + realtime sync, phase-1 (see memory
`mobile-offline-first-sync`):

- Local SQLite via expo-sqlite + drizzle: `src/lib/db/` (`schema.ts`:
  tables `posts`,
  `pending_submissions`, `sync_meta`; `client.ts` opens `sirius.db`).
  Screens read via
  drizzle `useLiveQuery`. Migrations run in `<DbGate>` in `_layout.tsx`
  before first paint.
- **Device migration `0001_tense_the_hood.sql` runs on every prod user's
  SQLite** — it
  `ALTER TABLE posts ADD provider_id` + `ADD content_digest`. This is the
  #1 crash risk.
- Sync engine `src/lib/sync/` (engine, changes-pull, sse, reconcile,
  writes, events).
  Server push = Postgres LISTEN/NOTIFY → SSE `/api/app/posts/stream`
  (owner-filtered) →
  mobile pulls delta `/api/app/posts/changes`. SSE is a nudge; the delta
  pull is the data.
- Reconcile key: `Post.sourceRecordId` (submission id, or
  `batch:<batchId>` for images).
- DEFERRED / known-incomplete (do NOT treat as bugs): offline image/file
  upload (only
  `transport:"ingest"` replays), binary media caching, Queue/Tree SQLite
  mirroring.

## Tools & access already in the repo

- `apps/mobile/scripts/test-tree-categories.sh` — agent-device assertion
  the Tree outline renders.
- `scripts/probe-embedding-scene.sh` — agent-browser; pulls + analyzes
  the scene spectrum for any
  HOST (`HOST=https://lesswhelmed.com EMAIL=… PASSWORD=…
scripts/probe-embedding-scene.sh`).
- **agent-device** skill (CLI `agent-device`, v0.14.6; run `agent-device
help workflow` first):
  iOS sim "iPhone 17 Pro" + physical devices (Meowinas / iPhone) are
  booted. Dev-client bundle
  id `dev.copt.sirius` (points at sirius.local). A device running prod
  build #17 receives the OTA.
- **agent-browser** skill — `agent-browser skills get core` first.
- **Prod SSH** (read-only unless told otherwise): host+key in
  `.env.production`
  (`DEPLOY_HOST`, `DEPLOY_SSH_KEY`); `ssh -i $KEY deploy@$HOST`. pm2 proc
  `sirius-worker`;
  logs `/home/deploy/logs/sirius-worker-{out,error}.log`. Worker is
  healthy (CLASSIFY_ENABLED=true).
- Creds: dev = `saleebmina@icloud.com` + `DEV_LOGIN_PASSWORD` (root
  `.env`). PROD is a SEPARATE
  auth realm — same email, different password — ASK the owner for it
  before prod-login steps.
- EAS: `bunx eas-cli` (logged in as `minasaleeb`). Rollback = republish
  the prior good group
  (`bunx eas-cli update:list --branch production` to find it) — ASK
  before doing it.

## Critical gotcha — "production" vs the simulator

The sim runs the DEV CLIENT (→ sirius.local), so it exercises the SAME
OTA JS but against the
DEV server. True prod validation = a **physical device on the production
build** (it pulls the
OTA on launch, applies on the NEXT launch) talking to lesswhelmed.com.
Use the sim for fast
functional iteration; use a physical prod-build device + prod-server
signals for the prod gate.
State explicitly which surface each finding came from.

## THE LOOP — repeat until exit criteria, narrating each pass

Pass 1 (smoke / migration safety):

- Cold-start the prod app twice on a physical device; confirm no
  white-screen/crash from the
  `0001` migration; confirm the Tree categories now render (the shipped
  fix).
- Tail `sirius-worker` + watch EAS dashboard for the update's adoption /
  errors.
  Pass 2 (offline-sync correctness — run these as the fan-out dimensions):
  a. **Migration idempotency**: fresh install vs upgrade-over-old-db;
  assert `posts` has
  `provider_id`+`content_digest` and no duplicate-column error.
  b. **Offline create → reconcile**: airplane-mode a note, relaunch, go
  online; assert the
  `pending_submissions` row replays and reconciles into the SAME local
  row (syncState→synced).
  c. **Realtime nudge**: ingest a post from web
  (`scripts/probe-embedding-scene.sh` host or the
  composer); assert SSE `/api/app/posts/stream` nudges → delta
  `/api/app/posts/changes` pulls
  → it appears live via `useLiveQuery` without a manual refresh.
  d. **Owner-scoping**: confirm the local mirror only holds
  `submittedById == me` posts.
  e. **Tree/Queue still on React Query** (not SQLite) — confirm no
  regression there.
  For each failure: reproduce minimally, capture the surface (sim/prod) +
  logs/screenshot, write
  the root cause to a `HANDOFF-<topic>.md`, and PROPOSE the fix — do not
  edit prod-shipped code or
  re-OTA without the owner's explicit OK. Use the
  `diagnose`/`systematic-debugging` skill for hard ones.

## EXIT CRITERIA (stop the loop, report)

- Prod app cold-starts clean on build #17 post-OTA (no migration crash)
  AND Tree categories render.
- All Pass-2 dimensions pass on the sim; (a)+(b)+(c) confirmed on a
  physical prod-build device.
- Every failure found is captured in a HANDOFF with a proposed fix + a
  bead (`br create`).
- A short final report: what passed, what's broken, and a rollback
  recommendation (yes/no) with reason.
  Run `br sync --flush-only` at session end. Do NOT commit, push, deploy,
  OTA, or roll back without asking.
