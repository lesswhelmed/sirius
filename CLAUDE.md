# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sirius-2-simple` is a content-ingest + AI publishing app, not the Turborepo starter the
root `README.md` still describes (that README is stale — ignore it). Users submit URLs,
images, or notes; a background worker drafts a blog/finding/sight post with Gemini and
writes it straight to Postgres, where the web app serves it. It is a simplified migration
of `copt-dev` (see the additional working directory) that **deliberately dropped the
git-branch + commit + PR publishing flow in favor of direct DB writes** — comments
throughout `apps/worker` reference what was removed.

## Commands

Package manager is **bun** (`bun@1.3.14`, hoisted linker). Run from repo root unless noted.

```sh
bun install                     # install (use --frozen-lockfile on deploy)
bun run build                   # turbo build all
bun run dev:proxy               # one-time per boot: start portless + trust CA in the iOS Simulator
bun run dev                     # turbo dev all (persistent); web served at https://sirius.localhost
bun run lint                    # turbo lint (eslint, --max-warnings 0 per app)
bun run check-types             # turbo tsc --noEmit (web also runs `next typegen` first)
bun run format                  # prettier on **/*.{ts,tsx,md}

# Database (filtered to @repo/db)
bun run db:generate             # prisma generate — REQUIRED before typechecking/building; output is gitignored
bun run db:migrate:dev          # prisma migrate dev (local)
bun run db:migrate:deploy       # prisma migrate deploy (prod)
bun run db:studio               # prisma studio — inspect IngestSubmission/Post rows
bun run db:push                 # prisma db push (no migration)

# Worker (ingest daemon)
bun run worker:setup            # interactive preflight: checks env, generates INGEST_TOKEN, makes staging/sight dirs
bun run worker:dev              # run the daemon with --watch

# Single app
turbo dev --filter=web          # or --filter=worker, --filter=mobile
turbo build --filter=web
```

**Local dev URL (portless).** The web app's `dev` script runs through
[portless](https://www.npmjs.com/package/portless), a reverse proxy that serves it at the
stable HTTPS name **`https://sirius.localhost`** (forwarding to `next dev` on a pinned port
3000). This is so the mobile app's `EXPO_PUBLIC_AUTH_BASE_URL` never goes stale when the
machine's network changes. Config is the `"portless"` key in `apps/web/package.json`
(`name: sirius`, `appPort: 3000`). `bun run dev:proxy` (→ `scripts/setup-dev-proxy.sh`) is a
one-time-per-boot step that starts the proxy daemon and — crucially — runs
`xcrun simctl keychain booted add-root-cert ~/.portless/ca.pem` so the **iOS Simulator** trusts
portless's CA (the simulator does NOT inherit the macOS trust store). The port is pinned to 3000
so the worker's `WEB_REVALIDATE_URL=http://localhost:3000/...` keeps working (the worker isn't a
portless child). Dev hostnames have ONE source of truth — **`packages/auth/dev-hosts.js`**
(`DEV_HOSTS`) — from which both `apps/web/next.config.js` (`allowedDevOrigins`) and
`packages/auth/src/index.ts` (`devTrustedOrigins`, as `https://<host>`) derive; add a
hostname there and both layers follow (the file's header documents the contract,
including that `apps/mobile/.env`'s `EXPO_PUBLIC_AUTH_BASE_URL` must use one of these
hosts). Bypass with
`PORTLESS=0 bun --cwd apps/web run dev:app`. The proxy runs in **LAN mode** (`--lan`,
persisted by portless): the same app is also served at **`https://sirius.local`** over mDNS
for physical devices on the Wi-Fi — `apps/mobile/.env` points the dev client there, and a
phone must trust the portless CA (`dev:proxy` prints the install steps). The
physical-device test runbook lives in `docs/HANDOFF-on-device-ai.md`.

There is **no test runner wired up** (`scripts/testing/` exists but nothing in package.json
runs it). Don't claim tests pass — there are none to run.

Mobile (Expo, run from repo root):
```sh
bun --cwd apps/mobile start     # Metro / Expo dev server
bun --cwd apps/mobile ios       # iOS Simulator
bun --cwd apps/mobile android   # Android emulator
```

### Mobile builds (EAS)
Release builds go through **EAS Build** (cloud), config in `apps/mobile/eas.json`. The
`ios/`/`android/` dirs are gitignored — they're regenerated from `app.json` + `bun.lock`
by `expo prebuild`; **never commit them**. The EAS project is
`c14faf73-b1f9-425e-b66b-974ac26b827c` (`app.json` → `extra.eas.projectId`).

```sh
bun --cwd apps/mobile build:preview   # eas build --profile preview  (internal)
bun --cwd apps/mobile build:prod      # eas build --profile production (store)
bun --cwd apps/mobile update:prod     # eas update --branch production (OTA JS push)
```

- Three profiles/channels: `development` (dev client, localhost), `preview` (internal,
  `lesswhelmed.com`), `production` (store, `lesswhelmed.com`). The per-profile
  `EXPO_PUBLIC_AUTH_BASE_URL` is the only env that differs.
- Reproducibility: `cli.appVersionSource: "remote"` (EAS owns build numbers),
  `requireCommit: true` (clean tree only), pinned `node`/`image`.
- OTA: `expo-updates` with `runtimeVersion.policy: "fingerprint"` — updates only reach
  builds with a matching native fingerprint.
- Prod auth: `AUTH_TRUSTED_ORIGINS` **must include `siriusapp://`** (dev trusts it
  automatically — see `packages/auth/src/index.ts`).

Lint note: **ESLint** does the real linting per app (flat config from `@repo/eslint-config`).
`biome.json` only configures the CSS-modules/Tailwind parser — it is not the linter.
Stack pins: TypeScript `~6.0.3`, React 19, Next.js 16, Tailwind v4, Prisma 7, Zod 4.

## Architecture

### Workspaces
- `apps/web` — Next.js 16 App Router. The product: broker storefront, ingest UI, queue, auth pages, and all HTTP APIs.
- `apps/worker` — long-running Bun daemon. Polls the DB for ingest jobs, runs the Gemini pipeline. Runs via `bun run src/index.ts` (no build step).
- `apps/mobile` — Expo / React Native client (auth + composer + library/queue), talks to `apps/web` APIs with the better-auth Expo client.
- `apps/docs` — **unused** vestigial Turborepo starter stub. Ignore unless explicitly asked.
- `packages/db` — `@repo/db`: Prisma schema, generated client, and all DB access helpers.
- `packages/auth` — `@repo/auth`: the single `betterAuth(...)` instance + email sending.
- `packages/ui` — `@repo/ui`: shared React components.
- `packages/{eslint-config,typescript-config}` — shared configs.

### The ingest pipeline (the core flow)
This is a producer/consumer queue backed by the `IngestSubmission` table — the web app and
worker never call each other directly, they only share the DB and the `@repo/db` helpers.

1. **Submit (web).** All submission logic funnels through `apps/web/lib/ingest/submit.ts`,
   which computes a dedup `contentHash`, stages image bytes to disk, and calls
   `createSubmission` (`packages/db/src/ingest.ts`). A row is inserted as `pending`.
   - **Two auth paths, same submit logic:**
     - `/api/ingest` + `/api/ingest-images` — **bearer token** (`INGEST_TOKEN`, constant-time
       compared in `lib/ingest/auth.ts`). Used by iOS Shortcuts / scripts. No user attribution.
     - `/api/app/ingest` + `/api/app/ingest-images` — **session auth** (better-auth). Used by
       the web composer and mobile; attaches `submittedById`.
2. **Claim (worker).** `apps/worker/src/index.ts` polls every `INGEST_POLL_INTERVAL_MS`.
   `claimNextNonImage` grabs one url/note row; `claimReadyImageBatch` waits until all
   `totalCount` rows of an image `batchId` are present, then claims the whole batch as one
   SIGHT post. Claiming flips `pending → processing` via a guarded `updateMany` (count-check
   = optimistic lock). State machine: `pending → processing → completed | failed`.
3. **Draft (worker).** `pipeline/pipeline.ts` runs two stages: `runGemini` then `writePost`.
   `gemini-runner.ts` uses the Vercel AI SDK (`generateText` + `Output.object(zodSchema)`) so
   output is schema-validated, no manual JSON parsing. Routing:
     - URL ingest → two-step: `url_context` tool fetches/summarizes (tools + JSON mode can't
       coexist in one Gemini call), then a second call structures it. Forced type `FINDING`.
     - Single Instagram URL → dedicated Apify path (`pipeline/instagram/`).
     - Single YouTube URL → dedicated transcript/chunk path (`pipeline/youtube/`).
       Both dedicated paths **fall back to `url_context`** on failure.
     - Image batch → inline image parts, forced type `SIGHT`.
     - Note → forced type `BLOG`.
   The post **type is forced by the worker after the model returns** so a model regression
   can't drift it.
4. **Persist (worker).** `post-writer.ts` (replaces copt-dev's mdx-writer): copies image
   batches into `apps/web/public/sight/<batchId>/` (override with `SIGHT_IMAGE_DIR`),
   rewrites `IMAGE_N` placeholders in the body to served URLs, `connectOrCreate`s Tag/Category
   rows, and **upserts** the `Post` by slug. Then the worker marks the submission(s) completed
   and deletes the staged file.

### Database (`packages/db`)
- PostgreSQL via Prisma 7 **driver adapter** (`@prisma/adapter-pg`, `PrismaPg`), not the
  classic engine. Singleton client in `src/index.ts`, cached on `globalThis` outside production.
- Generated client lands in `packages/db/generated/prisma` and is **gitignored** — you must
  run `db:generate` after a fresh clone or schema change or types won't resolve.
- DB access is wrapped in domain helpers (`ingest.ts`, `posts.ts`, `users.ts`, `inquiries.ts`)
  re-exported from `src/index.ts`. Prefer adding/using these over reaching for `prisma` directly.
- Model row types are re-exported by name (`Post`, `IngestSubmission`, …) rather than
  `export *` — Turbopack warns on `export *` from the generated CJS namespace.

### Auth (`packages/auth`)
- One `betterAuth` instance: email+password with **required email verification**, plugins
  `admin()` + `expo()` + `nextCookies()`. Emails sent via Resend (`src/email.ts`).
- Next.js mounts it at `/api/auth/[...all]`. Rate limiting is DB-backed and **production-only**.
- The Prisma User/Session/Account/Verification/RateLimit models use `@@map` to lowercase table
  names and match Better Auth field conventions — **don't rename fields without updating the
  auth config**. `User` carries extra broker-storefront fields (`handle`, `bio`, `location`).

### Web route groups (`apps/web/app`)
- `(app)` — session-gated broker cockpit (ingest, queue, library, inbox). `layout.tsx` calls
  `requireSession` and redirects to `/setup-handle` if the user has no `handle`.
- `(auth)` — sign-in/up, verify-email, forgot/reset password.
- `(public)` — public storefront: `/catalog`, `/catalog/[handle]`, `/listing/[slug]` + inquiry form.
- API layout: `/api/app/*` = session-authed app APIs; `/api/*` (ingest/ingest-images) = bearer;
  `/api/catalog/*` = public read; `/api/auth/*` = better-auth.

## Deployment
`bun run deploy` (`scripts/deploy-remote.sh`, reads `.env.production`) pushes `main`, runs
`deploy.sh` on the server over SSH, and verifies the public URL returns 200. `deploy.sh`
(idempotent) runs on the host: `git pull --ff-only` → `bun install --frozen-lockfile` →
`db:generate` → `db:migrate:deploy` → build into `apps/web/.next-builds/<id>` with
`.next-builds/current` symlinked (web `next.config.js` reads `distDir` from `BUILD_DIR`) →
`pm2 startOrReload ecosystem.config.cjs` → `pm2 save` → prune to 3 builds → `pm2 status`.
PM2 (`ecosystem.config.cjs`) runs two fork-mode processes: **sirius-web** (`apps/web`, `bun run
start`, port 3003) and **sirius-worker** (`apps/worker`, `bun run start`). Both load the
repo-root `.env`. The worker has no HTTP surface — it's purely the queue consumer. Full
server setup (Postgres, Caddy, env mirror) is in `DEPLOY.md`; `bun run env:production`
generates the local `.env.production` mirror (never overwrites an existing one).

## Environment
Copy `.env.example` to `.env` at the repo root (all apps read the root `.env`). Required for the
full pipeline: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` /
`NEXT_PUBLIC_BETTER_AUTH_URL`, `INGEST_TOKEN`, `GEMINI_API_KEY`, `RESEND_API_KEY`. Instagram
ingest additionally needs a paid `APIFY_TOKEN`; YouTube data API key is optional (transcript
fallback works without it). `turbo.json`'s `globalEnv` is the authoritative list of vars that
invalidate the build cache — add new ones there.
