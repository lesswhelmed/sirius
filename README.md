<div align="center">

# Sirius

**Submit a URL, image, or note — a background worker drafts an AI post with Gemini and publishes it straight to Postgres, where the web app serves it.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![Bun](https://img.shields.io/badge/Bun-1.3.14-black?logo=bun)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma)
![Expo](https://img.shields.io/badge/Expo-SDK_56-000020?logo=expo)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript)
![AI](https://img.shields.io/badge/AI-Gemini-8E75B2?logo=googlegemini)
![License](https://img.shields.io/badge/license-private-lightgrey)

</div>

`sirius-2-simple` is a content-ingest + AI publishing monorepo (Turborepo, managed with **bun**).
It's a simplified migration of `copt-dev` that **deliberately dropped the git-branch + commit + PR
publishing flow in favor of direct DB writes** — the worker writes posts to the database instead of
opening pull requests.

> For day-to-day agent/dev guidance, see [`CLAUDE.md`](./CLAUDE.md) — it's the authoritative
> architecture doc. This README is the onboarding overview.

### Highlights

|                            |                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ |
| 🧩 **Multimodal ingest**   | URLs, image batches, and plain notes — one queue, one pipeline                 |
| 🤖 **Schema-validated AI** | Vercel AI SDK + Gemini with `Output.object(zod)` — no manual JSON parsing      |
| 🔀 **Input-aware routing** | URL → `url_context`, Instagram → Apify, YouTube → transcript, images → gallery |
| 🗄️ **Direct-to-Postgres**  | No PRs, no MDX commits — the worker upserts `Post` rows the web app reads      |
| 📱 **Web + mobile**        | Next.js cockpit/catalog and an Expo client sharing one Better Auth instance    |

---

## How it works

The core is a producer/consumer queue backed by the `IngestSubmission` table. The web app and
worker **never call each other directly** — they only share the database and the `@repo/db` helpers.

```
                    ┌─────────────── apps/web ───────────────┐
  bearer token  ──► /api/ingest, /api/ingest-images          │
  session auth  ──► /api/app/ingest, /api/app/ingest-images  │
                    └────────────────────┬───────────────────┘
                                         ▼
                         IngestSubmission row (pending)
                                         │
                          apps/worker polls + claims (optimistic lock)
                                         ▼
                              pending → processing
                                         │
                         ┌───────────────┴────────────────┐
                         ▼   Gemini pipeline (AI SDK)      ▼
                   runGemini  ───────────────────►   writePost
                  (schema-validated draft)        (images → public/,
                                         │          Tag/Category, upsert Post)
                                         ▼
                    Post upserted (completed)  ──►  web serves the post
```

1. **Submit (web).** All submissions funnel through `apps/web/lib/ingest/submit.ts`: compute a
   dedup `contentHash`, stage image bytes to disk, insert a `pending` row.
   - **Bearer-token** routes (`/api/ingest`, `/api/ingest-images`) — for iOS Shortcuts / scripts;
     no user attribution.
   - **Session** routes (`/api/app/ingest`, `/api/app/ingest-images`) — for the web composer and
     mobile; attach `submittedById`.
2. **Claim (worker).** `apps/worker` polls every `INGEST_POLL_INTERVAL_MS`, fills up to
   `INGEST_WORKER_CONCURRENCY` in-flight jobs (capped at 8), and flips `pending → processing`
   with a count-checked `updateMany` (optimistic lock). Image batches wait until all `totalCount`
   rows of a `batchId` are present, then claim the whole batch as one post. Shutdown drains active
   jobs for `INGEST_SHUTDOWN_DRAIN_MS`, then exits and lets lease reclaim recover them.
3. **Draft (worker).** The Gemini pipeline routes by input, then **the worker forces the post type**
   after the model returns so a model regression can't drift it:

   | Input         | Path                                                | Forced type |
   | ------------- | --------------------------------------------------- | ----------- |
   | Plain note    | single Gemini call                                  | `BLOG`      |
   | URL (generic) | `url_context` tool → structure                      | `FINDING`   |
   | Instagram URL | dedicated Apify path → falls back to `url_context`  | `FINDING`   |
   | YouTube URL   | transcript/chunk path → falls back to `url_context` | `FINDING`   |
   | Image batch   | inline image parts                                  | `SIGHT`     |

4. **Persist (worker).** `post-writer.ts` copies image batches into
   `apps/web/public/sight/<batchId>/`, rewrites `IMAGE_N` placeholders in the body to served URLs,
   `connectOrCreate`s Tag/Category rows, and **upserts** the `Post` by slug. Then it marks the
   submission(s) `completed` and deletes the staged file.

### Data model (the two tables that matter)

- **`IngestSubmission`** — the queue. `status: pending → processing → completed | failed`
  (`skipped` for idempotent re-runs). `force=true` salts the `contentHash` to bypass dedup and
  regenerate. `batchId` / `totalCount` group image rows into one `SIGHT` post.
- **`Post`** — what the web app serves. Upserted by `slug`; `type` is one of
  `BLOG | FINDING | SIGHT | SOCIAL | CONCRETE`; SIGHT galleries live in the `images` JSON column.

### Embedding space

Posts, projects, and the category taxonomy are also embedded (Gemini embeddings) and rendered as
an explorable 3D scene.

- **What persists where:** `PostEmbedding` (per-post vector + owner), `PostCategoryMatch`
  (post → category linkage with scores, written by the worker's classify step),
  `ProjectEmbedding` (owner-scoped project vectors), and `CategoryEmbedding` (the global taxonomy).
- **`packages/embedding-scene`** — `@repo/embedding-scene`: shared types, a deterministic PCA
  projection (same rows in → same positions out, no DB and no `Date.now`), and the shared R3F
  (React Three Fiber) scene component used by both clients.
- **Clients:** the web app serves the scene at `/space` (session-gated, fed by
  `/api/app/embedding-scene`); mobile has a matching **Space** screen.
- **Scripts:** `apps/worker/scripts/backfill-post-embeddings.ts` embeds existing posts;
  `apps/worker/scripts/smoke-scene.ts` assembles the scene for the first backfilled owner and
  prints PASS/FAIL sanity lines (read-only — no test runner here, these are for human eyeballs).

---

## Workspaces

| Path                                  | What it is                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web`                            | Next.js 16 App Router — catalog, ingest UI, queue, auth, all HTTP APIs           |
| `apps/worker`                         | Long-running Bun daemon — polls the DB, runs the Gemini pipeline (no build step) |
| `apps/mobile`                         | Expo / React Native client (auth + composer + library/queue)                     |
| `apps/docs`                           | Unused vestigial Turborepo starter stub — ignore                                 |
| `packages/db`                         | `@repo/db` — Prisma schema, generated client, DB access helpers                  |
| `packages/auth`                       | `@repo/auth` — the single Better Auth instance + email                           |
| `packages/ui`                         | `@repo/ui` — shared React components                                             |
| `packages/{eslint,typescript}-config` | shared configs                                                                   |

**Stack:** TypeScript `~6.0.3`, React 19, Next.js 16, Tailwind v4, Prisma 7 (pg driver adapter),
Zod 4, Better Auth, Vercel AI SDK + Gemini, Expo SDK 56.

---

## Getting started

Requires [bun](https://bun.sh) `1.3.14`, PostgreSQL, and a `GEMINI_API_KEY`.

```sh
bun install
cp .env.example .env          # then fill in DATABASE_URL, secrets, GEMINI_API_KEY, …
bun run db:generate           # REQUIRED — generated Prisma client is gitignored
bun run db:migrate:dev        # create the schema
bun run worker:setup          # generates INGEST_TOKEN, makes staging dirs (interactive)
```

Run the stack:

```sh
bun run dev:proxy             # one-time per boot: start portless, trust the CA in the simulator
bun run dev                   # all apps (turbo, persistent) — web at https://sirius.localhost
bun run worker:dev            # just the ingest worker (--watch)
```

Local dev serves the web app behind [portless](https://www.npmjs.com/package/portless) at the
stable URL **`https://sirius.localhost`** (the proxy forwards to `next dev` on port 3000), so the
mobile app's auth base URL never goes stale when your network changes. Run `bun run dev:proxy` once
after a reboot before `bun run dev`. Bypass the proxy entirely with
`PORTLESS=0 bun --cwd=apps/web run dev:app` (plain `http://localhost:3000`).

Mobile (from repo root):

```sh
bun --cwd apps/mobile start   # Metro / Expo dev server
bun --cwd apps/mobile ios     # iOS Simulator
bun --cwd apps/mobile android # Android emulator
```

> The mobile app reads `EXPO_PUBLIC_AUTH_BASE_URL` from its **own** `apps/mobile/.env` (not the
> repo-root `.env`). Copy `apps/mobile/.env.example` to `apps/mobile/.env` — it defaults to
> `https://sirius.localhost` for simulator dev.

---

## Local dev URLs (portless)

Local dev serves the web app behind [portless](https://www.npmjs.com/package/portless) — a reverse
proxy that gives it a **stable, named HTTPS URL** instead of a raw `localhost` port:

```
https://sirius.localhost  ──►  portless proxy (:443)  ──►  next dev (:3000)
```

**Why:** the mobile app's `EXPO_PUBLIC_AUTH_BASE_URL` (which feeds Better Auth's session/refresh,
sign-in, and media URLs) used to hardcode a `localhost` address that went stale whenever the machine's
network changed. A named URL never drifts.

### One-time setup (per boot)

```sh
bun run dev:proxy   # → scripts/setup-dev-proxy.sh
```

This script:

1. Starts the portless proxy daemon on `:443` (auto-elevates with `sudo`).
2. Trusts portless's local CA in the macOS system store (`portless trust`).
3. **Adds the CA to the booted iOS Simulator** via
   `xcrun simctl keychain booted add-root-cert ~/.portless/ca.pem` — essential, because modern iOS
   Simulators do **not** inherit the macOS trust store, so HTTPS would otherwise fail with a cert
   error. Boot the simulator first (`bun --cwd apps/mobile ios`), then run this.

The proxy is a persistent daemon, so you only need this after a reboot (or `portless proxy stop`). To
start it automatically at login instead: `portless service install`.

### How it's wired

| Piece             | Detail                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Proxy config      | the `"portless"` key in `apps/web/package.json` (`name: sirius`, `appPort: 3000`)                                             |
| Web dev script    | `dev: portless` wraps `dev:app: next dev` (turborepo pattern)                                                                 |
| Pinned port       | `appPort: 3000` keeps the worker's `WEB_REVALIDATE_URL=http://localhost:3000/...` working (the worker isn't a portless child) |
| Origin allow-list | `allowedDevOrigins: ["sirius.localhost"]` in `apps/web/next.config.js` (Next 16 requirement)                                  |
| Auth trust        | `https://sirius.localhost` added to `devTrustedOrigins` in `packages/auth/src/index.ts`                                       |
| Mobile URL        | `EXPO_PUBLIC_AUTH_BASE_URL=https://sirius.localhost` in `apps/mobile/.env`                                                    |

### Bypass

To run plain `http://localhost:3000` without the proxy:

```sh
PORTLESS=0 bun --cwd=apps/web run dev:app
```

> **Simulator-only.** This setup targets the iOS Simulator (it shares the Mac's loopback, so
> `.localhost` resolves). A **physical device** would additionally need portless LAN mode
> (`portless proxy start --lan`, `.local` over mDNS) and the CA installed on the phone — not set up
> here.

---

## Command reference

**Build / quality**

| Command               | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `bun run build`       | turbo build all                                           |
| `bun run dev`         | turbo dev all (persistent); web behind portless           |
| `bun run dev:proxy`   | start portless + trust the CA in the booted iOS Simulator |
| `bun run lint`        | eslint per app (`--max-warnings 0`)                       |
| `bun run check-types` | `tsc --noEmit` (web runs `next typegen` first)            |
| `bun run format`      | prettier on `**/*.{ts,tsx,md}`                            |

**Database** (filtered to `@repo/db`)

| Command                     | What it does                                                                   |
| --------------------------- | ------------------------------------------------------------------------------ |
| `bun run db:generate`       | `prisma generate` — **required** before typecheck/build (output is gitignored) |
| `bun run db:migrate:dev`    | `prisma migrate dev` (local)                                                   |
| `bun run db:migrate:deploy` | `prisma migrate deploy` (prod)                                                 |
| `bun run db:studio`         | inspect `IngestSubmission` / `Post` rows                                       |
| `bun run db:push`           | `prisma db push` (no migration)                                                |

**Worker & mobile**

| Command                               | What it does                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `bun run worker:setup`                | interactive preflight: checks env, generates `INGEST_TOKEN`, makes staging/sight dirs |
| `bun run worker:dev`                  | run the ingest daemon with `--watch`                                                  |
| `bun --cwd apps/mobile build:preview` | EAS internal build                                                                    |
| `bun --cwd apps/mobile build:prod`    | EAS store build                                                                       |
| `bun --cwd apps/mobile update:prod`   | OTA JS push                                                                           |

> **No test runner is wired up.** `scripts/testing/` exists but nothing in `package.json` runs it —
> `bun test` does nothing meaningful.

---

## Configuration

All apps read the repo-root `.env`. See [`.env.example`](./.env.example) for the full list with
inline docs; `turbo.json`'s `globalEnv` is the authoritative list of vars that invalidate the build
cache.

**Required for the full pipeline**

| Var                                               | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                                    | PostgreSQL connection string (Prisma pg driver adapter)              |
| `BETTER_AUTH_SECRET`                              | Better Auth signing secret (`openssl rand -base64 32`)               |
| `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` | Auth base URL — `https://sirius.localhost` in dev                    |
| `INGEST_TOKEN`                                    | Bearer token for `/api/ingest*` (iOS Shortcuts / scripts)            |
| `GEMINI_API_KEY`                                  | Gemini key (`GOOGLE_API_KEY` / `GOOGLE_GENAI_API_KEY` also accepted) |
| `RESEND_API_KEY`                                  | Resend key for verification / reset emails                           |

**Optional / per-feature**

| Var                                                 | Purpose                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `APIFY_TOKEN`                                       | **Paid** Apify plan — required for Instagram URL ingest                                  |
| `YOUTUBE_DATA_API_KEY`                              | YouTube ingest enrichment (transcript fallback works without it)                         |
| `AUTH_TRUSTED_ORIGINS`                              | Comma-separated extra origins; **prod must include `siriusapp://`**                      |
| `REVALIDATE_TOKEN` + `WEB_REVALIDATE_URL`           | Worker → web cache invalidation (keep on `http://localhost:3000` in dev)                 |
| `SIGHT_IMAGE_DIR` / `SOCIAL_IMAGE_DIR`              | Override where the worker writes served images                                           |
| `INGEST_STAGING_DIR` / `INGEST_POLL_INTERVAL_MS` / `INGEST_WORKER_CONCURRENCY` / `INGEST_SHUTDOWN_DRAIN_MS` | Staging path / worker poll cadence / worker parallelism / shutdown drain                 |
| `AI_MODEL` / `YOUTUBE_AI_MODEL` / `EMBEDDING_MODEL` | Model overrides (defaults: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-embedding-001`) |
| `EXPO_PUBLIC_AUTH_BASE_URL`                         | Mobile base URL — set in `apps/mobile/.env`, **not** the root `.env`                     |

---

## vs. `copt-dev`

This repo is a leaner descendant of `copt-dev` (the additional working directory). The core
difference is how posts get published:

|                   | `copt-dev`                   | `sirius-2-simple`                 |
| ----------------- | ---------------------------- | --------------------------------- |
| Publish mechanism | git branch + commit + PR     | **direct DB upsert**              |
| Post storage      | MDX files in the repo        | `Post` rows in Postgres           |
| Worker output     | `mdx-writer.ts`              | `post-writer.ts`                  |
| Review step       | PR review before merge       | none — writes are immediate       |
| Trade-off         | auditable, slower, git-bound | fast, simpler, no version history |

Comments throughout `apps/worker` reference what was removed in the migration.

---

## Deployment

Run `bun run deploy` locally — it pushes `main`, runs `deploy.sh` on the server over SSH, and
verifies the public URL returns 200. `deploy.sh` (idempotent) runs on the host:
`git pull --ff-only` → `bun install --frozen-lockfile` → `db:generate` → `db:migrate:deploy` →
build into `apps/web/.next-builds/<id>` (symlinked `current`) → `pm2 startOrReload` → `pm2 save` →
prune to 3 builds. PM2 (`ecosystem.config.cjs`) runs two fork-mode processes — **sirius-web**
(port 3003) and **sirius-worker** (no HTTP surface) — both loading the repo-root `.env`.

See [`DEPLOY.md`](./DEPLOY.md) for full server setup (Postgres, Caddy, `.env.production` via
`bun run env:production`).

---

## Troubleshooting

| Symptom                                                            | Fix                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@repo/db` types won't resolve / Prisma types missing              | Run `bun run db:generate` — the generated client is gitignored and must be regenerated after clone or schema change                                                             |
| iOS Simulator shows a TLS/cert error on `https://sirius.localhost` | Boot the simulator, then run `bun run dev:proxy` (it runs `xcrun simctl keychain booted add-root-cert ~/.portless/ca.pem`; the simulator doesn't inherit the macOS trust store) |
| `401` from `/api/ingest` or `/api/ingest-images`                   | The `INGEST_TOKEN` in your request doesn't match `.env`; tokens are constant-time compared in `lib/ingest/auth.ts`                                                              |
| Sign-in fails with "email not verified"                            | Email verification is required. In dev the verify link is logged to the console; set a real `RESEND_API_KEY` to receive it                                                      |
| An image submission never becomes a post                           | Image batches wait until **all** `totalCount` rows for the `batchId` arrive — a missing/failed upload leaves the batch `pending`                                                |
| Worker isn't picking up jobs                                       | Check `DATABASE_URL` is reachable, the worker is running (`bun run worker:dev`), and `INGEST_POLL_INTERVAL_MS`                                                                  |
| Instagram ingest fails                                             | Needs a **paid** `APIFY_TOKEN`; without it the dedicated path falls back to `url_context`                                                                                       |

---

## Limitations

- **No automated tests or CI.** `scripts/testing/` holds manual e2e helpers, nothing more.
- **No publish history.** Direct DB writes mean no PR review and no git audit trail (by design — see
  the `copt-dev` comparison).
- **Instagram requires a paid Apify plan.** Other URL ingest works on the free path.
- **Local portless setup is iOS-Simulator-only.** Physical-device dev would additionally need
  portless LAN mode (`--lan`, `.local` mDNS) and the CA installed on the phone.
- **Post type is worker-forced.** The model can't choose the type; routing is by input kind.
- **Rate limiting is production-only.** Dev has no auth rate limits.
- **`apps/docs` is a vestigial Turborepo stub.** It builds but isn't part of the product.

---

## FAQ

**Why write straight to Postgres instead of opening PRs like `copt-dev`?**
Speed and simplicity. The migration deliberately traded the git-branch/commit/PR publishing flow for
immediate DB upserts.

**What's the minimum I need to draft a post locally?**
`DATABASE_URL` + `GEMINI_API_KEY` (and a migrated DB). `RESEND_API_KEY` is only needed for
verification emails; `APIFY_TOKEN` only for Instagram.

**What's the difference between the two ingest API paths?**
`/api/ingest*` uses a **bearer token** (`INGEST_TOKEN`) with no user attribution — built for iOS
Shortcuts and scripts. `/api/app/ingest*` uses a **session** (Better Auth) and attaches
`submittedById` — used by the web composer and mobile.

**How do I submit without the UI?**
`POST` to `/api/ingest` with `Authorization: Bearer <INGEST_TOKEN>` and a URL/note payload, or
`/api/ingest-images` for image bytes.

**Where do submitted images end up?**
Copied into `apps/web/public/sight/<batchId>/` (override with `SIGHT_IMAGE_DIR`); `IMAGE_N`
placeholders in the draft body are rewritten to the served URLs.

**How do I reprocess a submission that was already handled?**
Submit with `force=true` — it salts the `contentHash` so the dedup check doesn't skip it.

**Why `https://sirius.localhost` in dev instead of `localhost:3000`?**
So the mobile app's `EXPO_PUBLIC_AUTH_BASE_URL` stays stable across network changes. portless proxies
the name to `next dev` on the pinned port 3000.

---

## Contributions

This is a solo-maintained project. **Issues and bug reports are welcome.** PRs are reviewed at the
maintainer's discretion and may be reimplemented rather than merged directly — open an issue first if
you're planning anything substantial.

## License

Private — all rights reserved. No license is granted for reuse or redistribution.
