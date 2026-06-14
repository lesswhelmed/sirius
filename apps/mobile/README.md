# `apps/mobile` — Sirius (Expo / React Native)

The mobile client for **sirius-2-simple** — a content-ingest + AI publishing app.
Capture URLs, notes, images, or voice memos; they flow into the same ingest queue the
web app and worker share, get drafted (on-device or by the server's Gemini stage), and
land as posts. See the repo-root [`CLAUDE.md`](../../CLAUDE.md) for the full pipeline.

Built with Expo (SDK 56, RN 0.85, New Architecture), `expo-router`, the better-auth Expo
client, `@tanstack/react-query`, and on-device LLM drafting via `llama.rn`.

## Tabs & screens

- **Capture** (`(tabs)/composer.tsx`) — stage notes / URLs / images / audio and submit.
- **Catalog** (`(tabs)/library.tsx`) — your published posts.
- **Queue** (`(tabs)/queue.tsx`) — submissions moving `pending → processing → done`.
- **Tree** (`(tabs)/tree.tsx`) — an outline of the analysis taxonomy + focus areas; tap a
  node to drill into its index of posts. The native counterpart of web's `/space`
  Observatory, sharing tree/drill logic from [`@repo/embedding-scene`](../../packages/embedding-scene).
- Detail/utility routes: `post/[slug]`, `space`, `focus`, `llm` (on-device AI chat),
  `llm-test` (dev draft bench), `shareintent`.

## On-device AI

Notes/URLs/images can be drafted **locally** with `llama.rn` (`src/lib/llm/*`) before
submitting — privacy + latency, soft-failing to the server's Gemini stage on any error.
`llama.rn` is pinned at **0.12.4** (root `overrides`); the `verify:native-ai` gate asserts
the native module is wired before every build. Deep design notes:
[`docs/HANDOFF-on-device-ai.md`](../../docs/HANDOFF-on-device-ai.md).

## Develop

Run from the **repo root** (everything reads the root `.env`):

```sh
bun run dev                  # full stack: boots the iOS Simulator, portless proxy, web,
                             # worker, and this app (native build + Metro). Web at
                             # https://sirius.local (LAN mode serves ONLY the .local name).
bun --cwd apps/mobile ios    # fast JS-only escape hatch (skips the clean prebuild)
bun --cwd apps/mobile start  # Metro / Expo dev server only
bun --cwd apps/mobile android
```

`ios/` and `android/` are **gitignored** — regenerated from `app.json` + `bun.lock` by
`expo prebuild`; never commit them. The everyday `bun run dev` does a clean prebuild only
when a native input changed, else a fast incremental run.

## Release builds (EAS)

Cloud builds via EAS (`eas.json`). Three profiles/channels: `development` (dev client,
localhost), `preview` (internal, `lesswhelmed.com`), `production` (store). Every `build:*`
script runs `verify:native-ai` first. Root one-liners:

```sh
bun run mobile:build:ios | :android | :all     # eas build --profile production
bun run mobile:build:preview                   # eas build --profile preview
bun run mobile:build:dev                        # eas build --profile development
bun run mobile:submit:ios | :android           # eas submit  --profile production
```

EAS `requireCommit: true` → build from a clean, committed tree. `runtimeVersion.policy:
"fingerprint"` → OTA updates only reach builds with a matching native fingerprint.
