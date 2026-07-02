# Mobile LLM chat modernization — design

- **Date:** 2026-07-02
- **Status:** Approved (user, 2026-07-02)
- **Surface:** mobile `/llm` chat + `POST /api/app/chat`
- **Related:** `docs/llm/LLM-SOURCE-OF-TRUTH.md` §3 (must be updated in the same change)

## Goal

Foundation-first modernization of the mobile chat: replace the hand-rolled SSE
protocol + bespoke client state with the AI SDK 6 standard stack (UI Message
Stream on the server, `useChat` on mobile), and ride the visible upgrades that
become cheap once typed message parts exist.

## Decisions

1. **Wire protocol: full AI SDK UI Message Stream.** Server emits
   `toUIMessageStreamResponse()`; mobile consumes with `@ai-sdk/react`
   `useChat` + `DefaultChatTransport` over `expo/fetch`. The hand-rolled
   `data:{t:"token"|…}` frames (and `sse-parse.ts`/`chat-stream.ts`) retire.
   Not backward compatible — acceptable because the chat backend shipped
   2026-07-01 and is in no store build.
2. **History stays local SQLite, UIMessage-shaped.** Messages persist as full
   `UIMessage` JSON (typed parts) instead of flat `content + sourcesJson`.
   No server-side history; sync can layer on later.
3. **UI scope (all four):** core chat hygiene (markdown, stop, smart
   autoscroll, editable-while-streaming, copy, retry/regenerate), tool/status
   visibility, virtualized message list, corpus-grounded empty state.

## 1. Server (`apps/web`)

`runAskAgent` already uses `streamText` with tools, so the route change is thin:

- `POST /api/app/chat` accepts the standard `useChat` body
  (`{ messages: UIMessage[], id, … }`), validates, converts with
  `convertToModelMessages`. Session auth + per-user/global rate limits
  unchanged.
- Response is built with `createUIMessageStream` +
  `createUIMessageStreamResponse`. Tool calls (`search_posts`, `get_post`)
  stream as typed tool parts — these power the live activity UI.
- **Sources** are emitted as a custom `data-source-posts` part built from
  `run.opened` (title/slug/excerpt only, mirrors today's `ChatSource`).
- **`get_post` tool outputs are trimmed for the wire** so full post bodies do
  not stream to (and persist on) the device; the model still sees full bodies.
- `lib/chat/sse.ts` chat frame codec retires. The posts-stream SSE route it
  imitated is untouched.

## 2. Mobile transport + state (`apps/mobile`)

- New dep `@ai-sdk/react`. `useChat` with
  `DefaultChatTransport({ fetch: expoFetch, api: authBaseURL + "/api/app/chat",
  headers: sessionCookieHeader() })`.
- Delete `lib/research/chat-stream.ts`, `lib/research/sse-parse.ts` and their
  tests. Abort, status (`submitted/streaming/ready/error`), `stop()`,
  `regenerate()` come from the hook.
- **Persistence:** drizzle migration adds `partsJson` to `chat_messages`.
  User turn saved on send; assistant `UIMessage` saved in `onFinish`.
  Existing rows read compatibly: `content` → one text part, `sourcesJson` →
  the sources data part. A pure `UIMessage ↔ row` mapping module stays
  `bun test`-able (nav-dedupe precedent — no react-native imports).

## 3. UI layer (`llm.tsx` decomposed into `src/components/chat/`)

- **Message list:** `@legendapp/list` with `alignItemsAtEnd` +
  `maintainVisibleContentPosition`; pins to bottom only while the user is at
  the bottom; "jump to latest" pill otherwise.
- **Rendering:** assistant text parts through a themed
  `react-native-markdown-display`; tool parts render a live activity line
  ("Searching your posts…" / "Reading *Title*…"); the sources data part
  renders the existing tappable Sources cards.
- **Composer:** input stays editable while streaming; Send toggles to Stop
  mid-stream; error rows offer Retry (`regenerate()`); copy a message via
  `expo-clipboard`.
- **Empty state:** starter chips from the local offline mirror (recent
  categories/titles) — no new endpoint.

## 4. Blast radius / consistency

- `test-bench.ts` `runServerChatTest` updated to the new protocol.
- `docs/llm/LLM-SOURCE-OF-TRUTH.md` anchors A12/A14/A15 + §3 updated in the
  same change (living-doc rule).
- Parked on-device code (`ask.ts`, `engine.ts`, vector store, drafting)
  untouched.
- Web chat is out of scope but gets `useChat` compatibility for free.

## Error handling & offline

`onError` maps to the same friendly states as today (offline message,
rate-limited with retry-after); stream aborts on screen leave/unmount; an app
kill mid-stream keeps the persisted user turn (unchanged).

## Testing

- Pure mapping helpers under `bun test`.
- Server route verified by live curl (authed).
- End-to-end: dev bench deep link `siriusapp://llm-test?run=serverchat` + a
  manual `/llm` pass by the user (exact steps handed over at the end).
- Lint/typecheck with `--force` (turbo stale-cache rule).
