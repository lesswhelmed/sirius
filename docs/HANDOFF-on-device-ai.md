# Handoff — sirius-2-simple, on-device AI drafting (react-native-ai/llama)

**Date:** 2026-06-11 (evening update) · **Branch:** `idk/something-cool` · **User:** saleebm

## Where we are

On-device LLM drafting is **runtime-verified end-to-end on the iOS Simulator** (Phases
A + B of the plan). Note submitted in the app → local Qwen 2.5 3B drafts it →
`IngestSubmission.payload.draft` carries `engine: llama.rn:qwen2.5-3b-instruct` → worker
completes in **<1s** (Gemini skipped) → Post content is the on-device draft verbatim
(posts `morning-swim-and-seals`, `night-market-smoke`). Soft-fail contract also verified:
every earlier failed draft fell through to Gemini with zero data loss.

Three findings from the verification session (all addressed):
1. **JSI error = stale binary**, as the original plan said — fixed by installing the
   fresh build (no code change).
2. **`llama.rn@0.11.5` breaks structured output** through `@react-native-ai/llama@0.12`
   (peer range `^0.10.1`): the json_schema grammar is silently never applied
   (fail-open), proven with a trivial `{answer: string}` probe returning prose. USER
   DECISION: keep 0.11.5, work around in app code — `curate.ts` now uses
   `generateObject(schema)` + `experimental_repairText` (extracts the JSON object,
   escapes raw newlines Qwen emits inside strings) + JSON shape spelled out in the
   prompt (body right after title, marked REQUIRED — Qwen omits trailing long fields) +
   `maxOutputTokens: 1024`. `generateObject` is deprecated in ai v6 but is the only API
   with the repair hook.
3. **Interrupted GGUF downloads wedge the model as "ready"** (library checks are
   existence-only; a 960MB fragment of the 2.1GB Qwen did this) — `engine.ts` now writes
   a `<file>.complete` marker only after all files finish, `isModelReady` requires it,
   and `downloadModelById` deletes marker-less partials before re-downloading. The dev
   sim's existing Qwen file was size-verified against HF and given its marker manually.

Composer UX (user requirement): the "Draft on device" switch is **hidden until a model
is on disk** — an "On-device AI / Get the model →" CTA (→ `/llm`) renders instead.

## What changed this session

Approved plan (full design, phases 0/A/B/C/D, verification matrix, risks):
`/Users/minasaleeb/.claude/plans/https-www-react-native-ai-dev-llms-txt-b-golden-melody.md`

- `6a220e0` — the bulk: `packages/ingest-draft` (shared zod schemas + versioned wire
  envelopes), worker `draft-runner.ts` + pipeline branch, mobile `src/lib/llm/*`
  (models/engine/settings/curate/transcribe), `outbox.ts`, `/llm` chat screen, composer
  toggle, queue banner, polyfills, app.json (llama.rn plugin + iOS memory entitlement).
- `b9a7d8e` — web: image-ingest accepts the SIGHT draft envelope (multipart `draft` field,
  soft-fail validation); transcribe.ts rewritten to lazy `await import()` (Android-safe).
- `b186a18`, `3c3fe47` — EAS dev-client enablement (expo-dev-client, fingerprintignore).
- `ca23d90` — stop logging session-cookie contents in the api debug trace.

**Still uncommitted (separate /space effort, left alone):** three pin to `0.181.0` +
Metro single-instance resolveRequest (expo-gl black-screen workaround), `space.tsx` /
`space-view.tsx` / embedding-scene drill-state changes, `api.ts` debug-trace removal,
`bun.lock`. The llama.rn `^0.11.5` bump + this effort's app changes are committed (see
"Where we are").

## Extraction/generation split (URLs, added 2026-06-12 — VERIFIED)

URL ingestion is now split into phases: **extraction** (server, de-identified) and
**generation** (on-device). `POST /api/app/extract` (session-authed for abuse control
ONLY — no DB writes, no user/URL/content in logs; per-user 10 + global 60 per 5-min
in-memory windows in `apps/web/lib/rate-limit.ts`) returns Gemini url_context's plain
summary via the new shared `packages/extraction` (`extractUrlContext`, also used by the
worker's url branch — moved verbatim, regression-verified). Mobile (`materials.ts`
urlHandler): curation on + model ready → fetch extract → `draftUrlPost` (FINDING voice,
engine `llama.rn:<model>+server-extract`, notes only join on-device) → submit with the
envelope; web/worker now honor SINGLE-url drafts (`submit.ts`, `draft-runner.ts` — type
still forced FINDING, Source:/original_url added server-side; multi-url still strips).
Every step soft-fails to the old server-drafted path (missing endpoint, 401/429/502,
offline). Verified: endpoint 401/400/429/200, no-draft regression (gemini path, 2s),
bench "URL draft from canned extract" card (offline generation-phase test, /llm-test),
composer e2e (worker 0.72s draft:client, FINDING + Source line). Later phase (documented
intent): cache extracts on-device so URL drafting can happen fully offline + outbox.

## Physical-device runbook (added 2026-06-12)

Dev is reachable from a phone via portless **LAN mode**: `https://sirius.local` (mDNS).
`bun run dev:proxy` now starts the proxy with `--lan` (persisted) and prints the
phone CA-trust steps. One dev URL everywhere: `apps/mobile/.env` points the dev client
at `https://sirius.local` (resolves on Mac, simulator, and phone); origins whitelisted
in `next.config.js` + `packages/auth`.

**One-time:** `eas device:create` (register the iPhone) → from `apps/mobile`:
`eas build --profile development-device --platform ios` (requireCommit: clean tree) →
install from the EAS QR. AirDrop `~/.portless/ca.pem` to the phone → Settings →
Profile Downloaded → Install → General → About → Certificate Trust Settings → full trust.

**Per session:** `bun run dev:proxy` → `bun run dev` (or `bun run notmobile:dev` +
`bun --cwd apps/mobile start` — always the package scripts) → open the dev client on the
phone → scan Metro's QR → sign in (web at `https://sirius.local`; LAN mode serves ONLY
the `.local` name, and `BETTER_AUTH_URL`/`NEXT_PUBLIC_BETTER_AUTH_URL` must match it).

**Acceptance checklist (in order, using the built-in benches):**
1. `/llm` chat streams on hardware (Phase A; model download ~2.1 GB on the phone).
2. `/llm-test` → Run all: note fixtures + "URL draft from canned extract" pass.
3. `/llm-test` Audio section: availability flips to **available** on iOS 26 hardware →
   Prepare assets → Record → transcript card → Draft from transcript (Phase C isolated).
4. Composer voice memo e2e: worker logs `draft:client`, BLOG post, **no file upload**
   (psql: submission has `payload.draft`, no `stagedFilePath`).
5. Outbox: airplane mode → note → "Saved offline" + queue banner → reconnect →
   auto-flush; background the app → reopen → foreground flush; Metro shows **no**
   "Background tasks are not supported" warn (registration OK on hardware), and an
   opportunistic background flush may land after 15+ min (best-effort, OS-scheduled).
6. URL split e2e: single URL → FINDING with `Source:` line, engine `+server-extract`,
   worker <1s.

Record results here; anything that fails becomes a new open item.

## Repo orientation (read first)

| Path | Why |
|---|---|
| `packages/ingest-draft/src/index.ts` | Single source of truth: `PostDraftSchema`, `SightDraftSchema`, `DraftEnvelopeSchema` (v1). Deliberately has **no `type` field** — worker forces PostType by kind. |
| `apps/worker/src/pipeline/draft-runner.ts` | `tryClientDraft`: defensive safeParse of the stored envelope; null → Gemini fallthrough. Only note + image kinds. |
| `apps/worker/src/pipeline/pipeline.ts` | Branch point: logs `draft:client` (skip) vs `gemini:parsed`. |
| `apps/mobile/src/lib/llm/engine.ts` | One prepared model at a time, n_ctx 4096, projectorPath for vision. |
| `apps/mobile/src/lib/llm/curate.ts` | `draftNotePost` / `draftSightPost` — `generateObject` + prompt-JSON + `experimental_repairText` (deliberate: only API with the repair hook; grammar enforcement is broken on llama.rn 0.11). Any failure → null → server drafts. |
| `apps/mobile/src/lib/llm/transcribe.ts` | Apple SpeechAnalyzer (iOS 26+), lazy-imported; audio bytes never upload on this path — submits as note-kind. |
| `apps/mobile/src/lib/outbox.ts` | FIFO at `documentDirectory/outbox.json`, note-kind only; 4xx drops, network error keeps. Idempotency = server contentHash (draft excluded from hash). |
| `apps/mobile/src/lib/materials.ts` | Where curation/transcription/outbox wire into note/audio/image handlers. |
| `apps/web/lib/ingest/{schema,submit}.ts` | Draft accepted on note + image only; stripped+logged for URLs; image draft soft-fails (image still ingests). |
| `apps/mobile/src/app/llm.tsx` | Chat demo screen (download → progress → streaming chat). |
| `CLAUDE.md` (repo root) | Commands, pipeline architecture, portless dev URL, EAS profiles. |

## Live processes / external systems

- Nothing running. Dev: `bun run dev:proxy` (once per boot) then `bun run dev`
  (web at `https://sirius.localhost`), `bun run worker:dev`, `bun --cwd apps/mobile ios`.
- EAS project `c14faf73-b1f9-425e-b66b-974ac26b827c`; `requireCommit: true` — clean tree
  before any cloud build. `ios/`/`android/` are gitignored, never commit them.
- HF models (filenames verified via HF API): `Qwen/Qwen2.5-3B-Instruct-GGUF/qwen2.5-3b-instruct-q4_k_m.gguf`
  (default), the 1.5B sibling, and `ggml-org/SmolVLM2-2.2B-Instruct-GGUF` main + mmproj
  (vision, experimental). Registry: `apps/mobile/src/lib/llm/models.ts`.

## Open items (in order)

1. ~~Resolve the llama.rn 0.11.5 bump~~ — RESOLVED: kept 0.11.5; structured-output break
   worked around in `curate.ts` (user decision). Consider filing the fail-open grammar
   bug upstream on `callstackincubator/ai`.
2. ~~Rebuild the dev client~~ — DONE (Jun 11 00:55 build, installed on the iPhone 17 Pro
   sim `08F63C27`).
3. ~~Phase A (simulator)~~ — DONE: `/llm` chat streams locally, no JSI error. Still
   pending: physical iPhone + Android.
4. ~~Phase B e2e (note path)~~ — DONE on simulator (draft used verbatim, sub-second
   worker completion, soft-fail fallback observed repeatedly). Still pending from the
   original matrix: same-note dedup check, hand-corrupted draft → Gemini fallback at the
   worker (was bun-eval-tested only).
5. ~~Outbox~~ — HARDENED + VERIFIED on simulator (2026-06-12): flush now also fires on
   app-foreground (AppState listener) and via a periodic background task
   (`expo-background-task`/`expo-task-manager`, `outbox-task.ts`, 15-min floor; iOS
   schedules opportunistically and never runs it after force-quit — foreground triggers
   stay primary). Queue banner shows retry status + "Send now →". Verified by injecting
   items into `Documents/outbox.json`: cold-start flush (draft envelope intact, Gemini
   skipped), foreground flush 12s after reopen, 25 duplicate items → 1 submission
   (contentHash dedup), banner live-decrements and clears. Still pending: background-task
   execution needs a **physical device** (sim can't run BGTaskScheduler — registration is
   skipped with a warn); real airplane-mode → reconnect on hardware.
6. **Phase C (iOS 26 PHYSICAL device)** — voice memo → BLOG with no file upload; Android
   falls back to upload path; silent audio → null → server path. The dev bench
   (`/llm-test`, Apple-only section) now tests this in isolation: record → the real
   `transcribeAudio` → transcript card → "Draft from transcript" through the real
   `draftNotePost` scorecard. Confirmed sim-blocked (2026-06-12): `prepare()` fails with
   "Assets not supported for locale: en_US" — SpeechAnalyzer assets don't ship in the
   simulator runtime, so this section only lights up on hardware.
7. **Phase D quality gate** — SmolVLM2 SIGHT drafts vs Gemini side-by-side on the same
   batch; check `imageAlts` order. The curate.ts JSON-prompt workaround applies to the
   vision path too but is UNTESTED with SmolVLM2. If quality is poor, ship dark (hide
   vision entry in the model registry) — architecture is unaffected.
8. Plan's regression sweep: toggle OFF → all existing paths byte-identical.
9. **Interrupted-download recovery branch untested live** (engine.ts deletes marker-less
   partials then re-downloads) — exercise by killing the app mid-download.
10. **Sheet keyboard UX bug (pre-existing, flagged):** with the keyboard open, the note
    sheet's "Add to tray" is unreachable — the Sheet Modal has no keyboard avoidance and
    tapping outside the field doesn't dismiss. Automation workaround: background+resume.
11. **Sim is shared with other agent sessions** — apps can grab foreground mid-flow and
    DerivedData was cleaned externally during this session; coordinate before long runs.

## Hard rules to honor (from user CLAUDE.md + this session)

- **Never deviate from the agreed approach without asking** — if blocked, stop and ask;
  don't substitute a different solution.
- **Don't assume — ask questions.** If you see an unrelated failure, say something (and
  ASK before delegating a fix).
- There is **no test runner** wired up; don't claim tests pass.
- The worker forces post **type from submission kind** — never let a client envelope set it.
- contentHash excludes the draft (dedup = source identity); don't "fix" that.
- `force` flag is the regeneration escape hatch, already wired.

## Suggested skills for the next session

- `agent-device` — driving the iOS Simulator/physical device for the test matrix (items 3–7).
- `verify` — structured runtime verification of the Phase B e2e flow.
- `diagnose` — if the dev-client build or llama.rn 0.11.5 bump breaks.

## What NOT to redo

- Repo-wide `bun run check-types` (9/9) and `bun run lint` pass as of `ca23d90` (only
  pre-existing `space.tsx` warnings). Functional bun-eval tests of `tryClientDraft` and
  `urlIngestSchema` passed (note→BLOG, sight→SIGHT+alts, invalid→null+warn, url→null).
- ai-SDK version question is settled: `@react-native-ai/llama@0.12` implements provider
  v3 → `ai@^6` on mobile (same major as worker), despite README saying v5.
- Engine choice (llama over MLC) was a user decision — MLC is iOS-only, requirement is both
  platforms. Don't re-litigate.
- Schema move out of `gemini-runner.ts` is behavior-neutral and re-exported for
  back-compat; HF GGUF filenames already verified against the HF API.
- Metro needs no changes for `@repo/ingest-draft` (workspace root already watched).
