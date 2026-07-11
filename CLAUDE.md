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
bun run dev                     # one-shot full stack: boot iOS Simulator + trust CA + web + worker + mobile. Mobile dev = `prebuild-if-native-changed.mjs && bun run verify:native-ai && expo run:ios`: clean-prebuilds (+ pod install) ONLY when a native input changed (deps, app.json/plugins, llama.rn override) or ios/ is missing — else fast incremental run (no Pod reinstall). Native build (on-device-AI/llama.rn JSI bridge baked in + verified) still FINISHES before Metro. Fast JS-only escape hatch: `bun --cwd apps/mobile ios`. web at https://sirius.local. Wrapper: scripts/dev.sh
bun run dev:stack               # raw `turbo dev` all (persistent), NO simulator/proxy prep — escape hatch
bun run dev:proxy               # heavy proxy reset / macOS re-trust / one-time iPhone CA-trust runbook (scripts/setup-dev-proxy.sh)
bun run lint                    # turbo lint (eslint --max-warnings 0 per package; mobile uses `expo lint`)
bun run check-types             # turbo tsc --noEmit (web also runs `next typegen` first)
bun run format                  # prettier on **/*.{ts,tsx,md}

# Database (filtered to @repo/db)
bun run db:generate             # prisma generate — REQUIRED before typechecking/building; output is gitignored
bun run db:migrate:dev          # prisma migrate dev (local)
bun run db:migrate:deploy       # prisma migrate deploy (prod)
bun run db:studio               # prisma studio — inspect IngestSubmission/Post rows
bun run db:push                 # prisma db push (no migration)
bun run db:migrate:reset        # prisma migrate reset

# Worker (ingest daemon)
bun run worker:setup            # interactive preflight: checks env, generates INGEST_TOKEN, makes staging/sight dirs
bun run worker:dev              # run the daemon with --watch

# Single app
turbo dev --filter=web          # or --filter=worker, --filter=mobile
turbo build --filter=web
```

**Local dev URL (portless LAN mode).** The web app's `dev` script runs through
[portless](https://www.npmjs.com/package/portless), a reverse proxy that serves it at the
stable HTTPS name **`https://sirius.local`** (mDNS/LAN mode — reachable from this Mac, the
iOS Simulator, AND phones on the same Wi-Fi; forwards to `next dev` on pinned port 3000).
**LAN mode serves ONLY the `.local` name** — `sirius.localhost` 404s while it's active
(it's the non-LAN-mode name; both stay whitelisted so switching modes is just an env
change). Config is the `"portless"` key in `apps/web/package.json` (`name: sirius`,
`appPort: 3000`). The everyday path is `bun run dev` (→ `scripts/dev.sh`), which boots the
Simulator, starts the proxy in LAN mode (only if nothing already holds :443), runs `xcrun
simctl keychain booted add-root-cert ~/.portless/ca.pem` so the **iOS Simulator** trusts
portless's CA (the simulator does NOT inherit the macOS trust store), then execs `turbo run
dev`. `bun run dev:proxy` (→ `scripts/setup-dev-proxy.sh`) remains the heavier path — it
force-restarts the proxy to switch modes, re-trusts in the macOS store, and prints the
one-time iPhone CA-trust steps. The port is pinned to 3000 so the
worker's `WEB_REVALIDATE_URL=http://localhost:3000/...` keeps working (the worker isn't a
portless child). Dev hostnames have ONE source of truth — **`packages/auth/dev-hosts.js`**
(`DEV_HOSTS`) — from which both `apps/web/next.config.js` (`allowedDevOrigins`) and
`packages/auth/src/index.ts` (`devTrustedOrigins`, as `https://<host>`) derive; the file's
header documents the contract, including that `EXPO_PUBLIC_AUTH_BASE_URL`
(apps/mobile/.env) and `BETTER_AUTH_URL`/`NEXT_PUBLIC_BETTER_AUTH_URL` (root .env) must
all point at the host the current proxy mode serves (`https://sirius.local`). Bypass with
`PORTLESS=0 bun --cwd=apps/web run dev:app`. The physical-device test runbook lives in
`docs/HANDOFF-on-device-ai.md`.

**Tests.** Root `bun run test` = `turbo run test` (per-package `bun test`; not every package
has a suite). Notable suites: the deterministic search harness in `packages/db` (one-time
`bun run db:test:setup`, then `bun --cwd packages/db run test:search` — see
`docs/search-ranking.md`), the security regression suite (`bun run test:security` →
`scripts/testing/security/`, plus `bun run test:security:db`), and `bun --cwd apps/mobile
test`. Coverage is NOT repo-wide — never claim "tests pass" beyond the suite you actually ran.

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

Root-level `mobile:build:*` / `mobile:submit:*` one-liners (see root `package.json`
scripts) delegate to the gated mobile scripts above; all use `bunx eas-cli`, no
global install needed. EAS `requireCommit: true` → run on a clean, committed tree.
Convention: a bare-platform name is **production**; preview/dev are profile-qualified.

For a dev client on a **physical** device use the `development-device` profile
directly (`bun --cwd=apps/mobile run build:dev:ios` builds the simulator dev
client; the `development-device` profile in `eas.json` is the on-hardware one —
no root alias yet, ask if you want one). A `production-device` profile also exists.

- **Android cloud build + Play submit runbook:** `apps/mobile/docs/ANDROID-BUILD.md`
  (server-URL env, the masked-view fingerprint pitfall, service-account key). iOS is the
  `ios-app-store-deploy` skill.
- Three profiles/channels: `development` (dev client, localhost), `preview` (internal,
  `lesswhelmed.com`), `production` (store, `lesswhelmed.com`). Per-profile env:
  `EXPO_PUBLIC_AUTH_BASE_URL` differs across all three; `preview`/`production` also set the
  RevenueCat keys, and `production` sets `EXPO_PUBLIC_ON_DEVICE_AI=true`. Because
  `apps/mobile/.env` is gitignored + `requireCommit` builds the committed tree, cloud builds
  get env **only** from the `eas.json` profile `env` (never the dev `sirius.local`).
- Reproducibility: `cli.appVersionSource: "remote"` (EAS owns build numbers),
  `requireCommit: true` (clean tree only), pinned `node`.
- OTA: `expo-updates` with `runtimeVersion.policy: "fingerprint"` — updates only reach
  builds with a matching native fingerprint.
- Prod auth: `AUTH_TRUSTED_ORIGINS` **must include `siriusapp://`** (dev trusts it
  automatically — see `packages/auth/src/index.ts`).
- On-device AI feature flag: **`EXPO_PUBLIC_ON_DEVICE_AI`** (mobile `.env` / per-EAS-profile
  in `eas.json`) is the master JS switch for ALL on-device LLM work (drafting, the `/llm`
  download+chat screen, the dev `/llm-test` bench). It **defaults off** (unset/anything but
  `"true"`); when off the whole feature is hidden — the composer "Draft on device" toggle and
  its `/llm` entry points don't render, `/llm` shows a neutral "not available" state,
  `canDraftOnDevice()`/`canDraftSightOnDevice()` short-circuit to `false`, and captures route
  to the server worker. Inlined by Expo at build time (`apps/mobile/src/lib/llm/flag.ts` →
  `ON_DEVICE_AI_ENABLED`). The native `llama.rn` bridge is still bundled (the gate below is
  unaffected), so flipping the env back on needs no native change.
- On-device AI gate: every `build:*` script and EAS's `eas-build-post-install` hook
  run `bun run verify:native-ai` (`scripts/verify-native-ai.mjs`) BEFORE the cloud
  prebuild/compile — it asserts `llama.rn` is installed at the pinned `0.12.4`, ships
  its iOS podspec + Android gradle (will autolink), and that the config plugin is in
  `app.json`. A build missing the on-device-AI JSI bridge **fails early** instead of
  shipping a binary that throws "JSI bindings not installed" after a model download.
  So no unequipped artifact can reach `eas submit`.
- llama.rn version is pinned (root `overrides` + `apps/mobile` dep) AHEAD of
  `@react-native-ai/llama@0.12`'s advisory `^0.10.1` peer: llama.rn **0.10.x** breaks
  under bridgeless New Arch (its iOS `install()` uses raw `[RCTBridge currentBridge]`,
  nil in bridgeless → JSI never installs). **0.11.5+ use `self.bridge` (the New-Arch
  interop proxy) and work.** Do NOT pin llama.rn down into 0.10.x to satisfy the peer
  warning — it silently kills on-device AI.

Lint note: **ESLint** does the real linting per app (flat config from `@repo/eslint-config`).
`biome.json` only configures the CSS-modules/Tailwind parser — it is not the linter.

## Architecture

### Workspaces

- `apps/web` — Next.js 16 App Router. The product: the public catalog, ingest UI, queue, auth pages, and all HTTP APIs.
- `apps/worker` — long-running Bun daemon. Polls the DB for ingest jobs, runs the Gemini pipeline. Runs via `bun run src/index.ts` (no build step).
- `apps/mobile` — Expo / React Native client. **5 tabs** (UI label ≠ route name): **Capture**
  (route `composer`), **Catalog** (route `library` — the private archive, which also carries
  the owner's "In flight" status board, folded in from the retired Queue tab; hidden when
  empty), **Friends** (route `feed` — NOT `friends`, which is the off-tab People manager;
  the merged shared-posts feed, see "The Friends hub" below), **Explore** (route `tree` —
  the analysis-taxonomy outline + 3D map, native counterpart of web's Observatory, see
  below), **Account** (route `settings`). There is **no Queue tab** — the legacy deep link
  `siriusapp://queue` resolves via a root `app/queue.tsx` `<Redirect href="/library" />`.
  URL scheme is **`siriusapp://`**
  (the bundle id `dev.copt.sirius` is for `simctl launch`, NOT a deep-link scheme); there is
  **no `/explore` route** — the Explore tab is `siriusapp://tree`. The full route + deep-link
  map is `apps/mobile/docs/ROUTES.md` (consult it before deep-linking). Talks to `apps/web`
  APIs with the better-auth Expo client; also drafts posts on-device (`src/lib/llm/`,
  llama.rn — see repo-root `docs/HANDOFF-on-device-ai.md`). Binding contracts for new mobile
  surfaces: theming/WCAG-AA in `apps/mobile/docs/THEMING.md`; accessibility (VoiceOver +
  Reduced Motion evidence, App Store Connect answers, and the "Accessibility contract"
  section) in `docs/accessibility.md`.
- `apps/mcp` — standalone Bun HTTP service (PM2 `sirius-mcp`, `MCP_PORT`; prod 3005) exposing
  each user's own post corpus to external AI agents over MCP (Streamable HTTP, stateless,
  Bearer API key via better-auth `apiKey()`). Owner-scoped, read-only. Its Claude Code
  client face is `plugins/sirius-research`.
- `apps/docs` — **unused** vestigial Turborepo starter stub. Ignore unless explicitly asked.
- `packages/db` — `@repo/db`: Prisma schema, generated client, and all DB access helpers.
- `packages/auth` — `@repo/auth`: the single `betterAuth(...)` instance + email sending.
- `packages/ui` — `@repo/ui`: shared React components.
- `packages/embedding-scene` — `@repo/embedding-scene`: host-agnostic scene-graph types
  (`EmbeddingScene`/`SceneNode`) + pure queries (`categoryChildren`, `projectNodes`,
  `linkedPosts`) + the `useSceneSelection` hook. Shared by web's `/space` Observatory and the
  mobile Tree tab so both compute the taxonomy outline + drill-in identically. Fed by
  `GET /api/app/embedding-scene` (session-authed).
- `packages/{ingest-draft,extraction}` — `@repo/ingest-draft` (versioned draft wire schemas
  shared by mobile on-device drafting + worker) and `@repo/extraction` (URL `url_context`
  extraction shared by `/api/app/extract` + the worker).
- `packages/safety` — `@repo/safety`: shared content-safety classifier (harm taxonomy,
  classifier prompt/schema, verdict→action policy, Gemini scan). Consumed by the web
  publish/edit gate; the worker still carries its own copy (convergence is a noted
  follow-up in the package's index.ts).
- `packages/github-ingest` — `@repo/github-ingest`: recognize a GitHub repo URL + gather
  structure/key-file evidence from the public GitHub API; shared by web
  `/api/app/github/preview` and the worker's dedicated GitHub runner.
- `packages/ingest-classify` — `@repo/ingest-classify`: pure, host-agnostic capture-tray
  classification (display + pre-submit validation ONLY — the worker still forces the final
  post type); shared by the web composer and mobile Capture.
- `packages/research-agent` — `@repo/research-agent`: host-agnostic core of the on-device
  "ask my posts" assistant (embed query → cosine-rank local vectors → stream a cited
  answer; runtimes injected via ports).
- `packages/{eslint-config,typescript-config}` — shared configs.
- `plugins/sirius-research` — Claude Code plugin: connects to the `apps/mcp` corpus server
  via `.mcp.json` and adds corpus-research skills; blackbox smoke in `scripts/smoke.sh`.

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
2. **Claim (worker).** `apps/worker/src/index.ts` polls every `INGEST_POLL_INTERVAL_MS`
 and fills up to `INGEST_WORKER_CONCURRENCY` in-flight jobs (capped at 8).
 `claimNextNonImage` grabs one url/note row; `claimReadyImageBatch` waits until all
   `totalCount` rows of an image `batchId` are present, then claims the whole batch as one
   SIGHT post. Claiming flips `pending → processing` via a guarded `updateMany` (count-check
 = optimistic lock). Shutdown drains active jobs for `INGEST_SHUTDOWN_DRAIN_MS`, then exits
 and lets lease reclaim recover anything still processing. State machine: `pending → processing → completed | failed`.
3. **Analyze (worker).** `pipeline/pipeline.ts` stages: `runGemini` → `writePost` →
   `assignOrg` → `reflection` (last two non-fatal). Since 2026-07 the model produces a
   **maximal-detail RAW ANALYSIS in neutral analyst voice** (NOT a stylized post in the
   user's voice) — every prompt builder embeds the shared contract in
   `pipeline/analysis-contract.ts` (`##` sections: Overview, Full breakdown, Key claims &
   facts, Notable quotes, Entities, Data & numbers, Context & metadata, Open questions;
   300-1200 words, SIGHT 150-500). The analysis lands in the same `Post.content` field, so
   search/embeddings get richer with no schema change. `gemini-runner.ts` uses the Vercel
   AI SDK (`generateText` + `Output.object(zodSchema)`). Routing:
   - URL ingest → two-step: `url_context` tool does maximal extraction (tools + JSON mode
     can't coexist in one Gemini call), then a second call structures it. Forced `FINDING`.
   - Single Instagram URL → dedicated Apify path (`pipeline/instagram/`).
   - Single YouTube URL → dedicated transcript/chunk path (`pipeline/youtube/`) — the
     analysis IS the body (the old `<details>` appendix + separate analysis call are gone).
     Both dedicated paths **fall back to `url_context`** on failure.
   - Image batch → inline image parts, forced type `SIGHT`.
   - Note → forced type `BLOG`, **author's note preserved verbatim** with the analysis
     appended after a `---` divider (never paraphrase the human's words).
     The post **type is forced by the worker after the model returns** so a model regression
     can't drift it.
   **Reflection stage** (`pipeline/reflection/generate.ts`): after classification, an
   unmetered flash ridealong generates 3-5 personalized questions (`ReflectionPrompt` rows)
   inviting the OWNER to write their own take — this is where `User.voiceProfile` now lives
   (it no longer shapes any body), plus corpus context (owner categories, focus areas,
   cosine-related posts via the assign-org embedding). Non-fatal; skipped for stubs/bearer;
   kill switch `REFLECTION_ENABLED=false`. The owner's answers (`ReflectionResponse`, text
   or audio+transcript) are the human-written layer, rendered on the post page on both
   hosts with audience inherited from the post (`canReadPost` — zero visibility columns).
4. **Persist (worker).** `post-writer.ts` (replaces copt-dev's mdx-writer): copies image
   batches into `apps/web/public/sight/<batchId>/` (override with `SIGHT_IMAGE_DIR`; the
   Instagram/social path uses `SOCIAL_IMAGE_DIR` → `public/social/`), rewrites `IMAGE_N`
   placeholders in the body to served URLs, `connectOrCreate`s Tag/Category rows, and
   **upserts** the `Post` by slug. Then the worker marks the submission(s) completed and
   deletes the staged file. `Post.aiTreatment` (`"full" | "stub"`) records whether the body
   got the AI pass — see the freemium note below.

**Freemium degraded bookmarks + Pro regenerate.** A free user past the weekly AI cap
(`entitlement.ts`; `AI_WEEKLY_LIMIT`, 0 now valid for dev testing) still gets a great
bookmark: `manual-stub.ts` writes their OWN material verbatim (notes/link/filename — no
upsell copy in the body), status DRAFT, `aiTreatment="stub"`, cover-gen skipped; embeddings
still run so the capture is searchable and in the on-device LLM DB. Upgrade CTAs live in UI
chrome keyed off the marker (mobile post detail/library/settings, web listing banner).
`POST /api/app/posts/[slug]/regenerate` (session + terms + rate limit + ownership-as-404 +
stub-only 409 + **server-side `checkProStatus` 402**) calls `requeueForRegeneration`
(packages/db/src/ingest.ts) which flips the original submissions back to pending with
`force=true` and restores `stagedFilePath` from `retainedFilePath` — the worker re-runs the
full pipeline and **updates the same Post in place** (marker flips to full, guarded
DRAFT+stub→PUBLISHED promote, entitlement re-checked at claim time).

**Materials, author notes & excerpts** (the client Material unit, how the capture note
travels + leads drafting prompts, the excerpt lifecycle, owner-only note surfaces incl.
chat): full write-up + maintained code links in `docs/materials-and-notes.md`.

### Serving worker-written media (`/sight`, `/social`)

The worker writes post images into `public/sight/` and `public/social/` **at runtime**, but
`next start` only serves `public/` files that existed at build time — so those URLs would 404
in production. Two custom catch-all route handlers bridge the gap:
`apps/web/app/sight/[...path]/route.ts` and `apps/web/app/social/[...path]/route.ts`, both
backed by `apps/web/lib/media/serve-media.ts` (path-traversal-guarded reads from the configured
dirs). In production a Caddy `file_server` fronts these paths directly off disk for speed
(`infra/caddy/` — Caddyfile + README); the Next handlers are the dev-mode + fallback path. Keep
`SIGHT_IMAGE_DIR` / `SOCIAL_IMAGE_DIR` in `.env.production` in sync with the Caddy roots.

### Retained originals + data archives (PRIVATE — `/private-uploads`)

Retention policy: every uploaded original (image/audio/video/document) is **kept** on
successful processing, not deleted — the worker MOVES the staged binary into a private
`ORIGINALS_DIR` (default `<repo>/private-uploads/originals`, keyed
`{userId}/{submissionId}/{file}`) and records `IngestSubmission.retainedFilePath`. Files
persist **until the user deletes the post** (no time-based cleanup); failed/idempotent-skip
submissions still drop their staged bytes. Unlike `/sight` + `/social`, these roots are
**NOT under `public/` and NEVER fronted by Caddy** — the only access is owner-gated:
`GET /api/app/posts/[slug]/source` (session + ownership; streams the original(s), JSON
file-index for batches), `GET /api/app/posts/[slug]/notes` (synthesized `.md`/`.txt`), and
`DELETE /api/app/posts/[slug]` (removes post + source rows + retained files). Both stream
via `apps/web/lib/originals/serve-original.ts` (traversal-guarded, `private, no-store`).
Users export everything from `/settings`: `POST /api/app/archive` enqueues an
`ArchiveRequest`; the worker (`apps/worker/src/archive/run-archive.ts`, claimed off the same
poll loop) zips their originals + note text into `ARCHIVES_DIR` and Resend-emails a
token link to `GET /api/app/archive/download?token=...` (token-gated, not session-gated, so
the email link works; expires after `ARCHIVE_TTL_HOURS`, default 7d). Keep `ORIGINALS_DIR` /
`ARCHIVES_DIR` in `.env.production` pointed **outside** the Caddy `public` root.

### Database (`packages/db`)

- PostgreSQL via Prisma 7 **driver adapter** (`@prisma/adapter-pg`, `PrismaPg`), not the
  classic engine. Singleton client in `src/index.ts`, cached on `globalThis` outside production.
- Generated client lands in `packages/db/generated/prisma` and is **gitignored** — you must
  run `db:generate` after a fresh clone or schema change or types won't resolve.
- DB access is wrapped in domain helpers (~22 modules: `ingest.ts`, `posts.ts`, `users.ts`,
  `friends.ts`, `groups.ts`, `search.ts`, `comments.ts`, `projects.ts`, `moderation.ts`,
  `archive.ts`, `embeddings.ts`, …) re-exported from `src/index.ts`. Prefer adding/using
  these over reaching for `prisma` directly.
- Model row types are re-exported by name (`Post`, `IngestSubmission`, …) rather than
  `export *` — Turbopack warns on `export *` from the generated CJS namespace.

### Auth (`packages/auth`)

- One `betterAuth` instance: email+password with **required email verification**, plugins
  `admin()` + `expo()` + `apiKey()` (per-user API keys for the `apps/mcp` corpus server) +
  `nextCookies()`. Emails sent via Resend (`src/email.ts`).
- Next.js mounts it at `/api/auth/[...all]`. Rate limiting is DB-backed and **production-only**.
- The Prisma User/Session/Account/Verification/RateLimit models use `@@map` to lowercase table
  names and match Better Auth field conventions — **don't rename fields without updating the
  auth config**. `User` carries extra public-profile fields (`handle`, `bio`, `location`).

### Web route groups (`apps/web/app`)

- `(app)` — session-gated owner cockpit (ingest, queue, library, inbox, and the `/space`
  **Observatory**). `layout.tsx` calls `requireSession` and redirects to `/setup-handle` if the
  user has no `handle`.
- `(auth)` — sign-in/up, verify-email, forgot/reset password.
- `(public)` — public catalog: `/catalog`, `/catalog/[handle]`, `/listing/[slug]` (with
  comments + related posts; the old Inquiry model/form was dropped).
- `(marketing)` — public marketing pages (incl. `/product`).
- API layout: `/api/app/*` = session-authed app APIs (incl. `/api/app/embedding-scene` →
  the Observatory/Tree scene, `/api/app/search` → curated corpus search, the reflection
  surface `/api/app/posts/[slug]/reflections` + `/api/app/reflection-responses/[id]` +
  `/api/app/reflections/changes` (mobile delta feed), and
  `/api/app/posts/[slug]/regenerate` → Pro re-run of a degraded bookmark); `/api/*`
  (ingest/ingest-images) = bearer; `/api/catalog/*` = public read; `/api/auth/*` =
  better-auth. Plus the media catch-alls `/sight/*` + `/social/*`
  (see "Serving worker-written media").

### Curated search (`/api/app/search` + web catalog + mobile library)

`@repo/db` `searchCorpus(viewerId, query, opts)` (`packages/db/src/search.ts`) is the single
search core: it runs Postgres full-text (the generated `Post.searchVector` tsvector + GIN,
ranked by `ts_rank`) AND brute-force embedding cosine over the viewer-visible `PostEmbedding`
candidate set, then fuses both ranked lists via Reciprocal Rank Fusion into one
`SearchHit[]` with `matchReasons` (`exact`/`similar`) badges. Visibility-gated (own posts any
status + friends' FRIENDS/PUBLIC published + PUBLIC) via the shared `searchVisibilityWhere`,
so FTS and embedding legs never disagree. The embedding leg degrades gracefully (returns
`partial: true`, FTS-only) when Gemini is down. `GET /api/app/search?q=&scope=all|mine|friends&cursor=`
wraps it; web `/catalog` (`curated-search.tsx`) and the mobile library tab
(`components/corpus-search.tsx`, online-only) both consume it, and the MCP `full_text_search`
tool was refactored onto the same core so UI and MCP can't drift. **Ranking principles +
the field-weighted `searchVector` (title>tags/categories>excerpt>body), the RRF fusion math,
query operators, and the deterministic test harness are documented in
`docs/search-ranking.md`.**

### The Friends hub + shared feed (`/friends` + mobile `feed` tab)

The shared-posts feed is a first-class surface, separate from the catalog. The
catalog (`/catalog`, mobile `library`) is a **private archive only**; the Friends
hub holds the merged feed. Web `/friends` is a `[Feed|People|Groups]` hub
(`apps/web/app/(app)/friends/`, Feed default); mobile has a dedicated bottom tab
(label "Friends", **route `feed`** — `friends` is taken by the People manager).
Both render the **same merged stream**: the viewer's own SHARED posts
(FRIENDS/GROUP/PUBLIC — **never** their own PRIVATE) interleaved with friends'
posts shared with them. The single query is `listVisibleToViewer` /
`visibilityWhereForViewer` in `packages/db/src/posts.ts` (mobile via
`GET /api/app/feed`, web direct). Own posts carry an **owner-only `ownAudience`
badge** (Friends / Public / group name → deep-link to the group, pre-selected);
peers' rows carry no group data (`ownAudience` is populated only for
`submittedById === viewerId` and `shareGroups` is stripped from every row — the
privacy invariant). **Full write-up + maintained code links in
`docs/friends-feed.md`.**

### The Observatory / Tree (`/space` + mobile Tree tab)

`/space` (`apps/web/app/(app)/space/space-view.tsx`) renders the embedding space: a 3D scene
(Three.js) + a sidebar taxonomy outline + a drill-in "Index" of posts under a selected node.
The mobile **Tree** tab (`apps/mobile/src/app/(tabs)/tree.tsx`) is its native, canvas-free
mirror — the same outline + a "Focus areas" (projects) section, tap-to-drill into the same
Index. Both consume `GET /api/app/embedding-scene` and share all tree-shaping/drill logic from
`@repo/embedding-scene` (`categoryChildren`, `projectNodes`, `linkedPosts`, `useSceneSelection`)
so the two hosts can never disagree. The scene is **owner-scoped** — it only populates for a
signed-in user who has posts with embeddings + categorized/assigned content.

## Deployment

`bun run deploy` (`scripts/deploy-remote.sh`, reads `.env.production`) pushes `main`, runs
`deploy.sh` on the server over SSH, and verifies the public URL returns 200. `deploy.sh`
(idempotent) runs on the host: `git pull --ff-only` → `bun install --frozen-lockfile` →
`db:generate` → `db:migrate:deploy` → build into `apps/web/.next-builds/<id>` with
`.next-builds/current` symlinked (web `next.config.js` reads `distDir` from `BUILD_DIR`) →
`pm2 startOrReload ecosystem.config.cjs` → `pm2 save` → prune to 3 builds → `pm2 status`.
PM2 (`ecosystem.config.cjs`) runs three fork-mode processes: **sirius-web** (`apps/web`, `bun run
start`, port 3003), **sirius-worker** (`apps/worker`, `bun run start`), and **sirius-mcp**
(`apps/mcp`, `bun run start`, `MCP_PORT=3005`). All load the
repo-root `.env`. The worker has no HTTP surface — it's purely the queue consumer. Full
server setup (Postgres, Caddy, env mirror) is in `DEPLOY.md`; `bun run env:production`
generates the local `.env.production` mirror (never overwrites an existing one).

## Environment

Copy `.env.example` to `.env` at the repo root (all apps read the root `.env`). Required for the
full pipeline: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` /
`NEXT_PUBLIC_BETTER_AUTH_URL`, `INGEST_TOKEN`, `GEMINI_API_KEY`, `RESEND_API_KEY`; production
additionally requires `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (deploy.sh enforces it). Instagram
ingest additionally needs a paid `APIFY_TOKEN`; YouTube data API key is optional (transcript
fallback works without it). `turbo.json`'s `globalEnv` is the authoritative list of vars that
invalidate the build cache — add new ones there.

<!-- bv-agent-instructions-v2 -->

---

## Beads Workflow Integration

Issue tracking uses beads (`br`) + beads_viewer (`bv`), stored in `.beads/` and tracked in git.
Full workflow (bv robot flags, triage → claim → close, session protocol): invoke the `beads` skill (`.claude/skills/beads/SKILL.md`).
