# scripts/testing/MOBILE-E2E — agent-device end-to-end flows (iOS)

The mobile counterpart of [`README.md`](./README.md) (which covers the **web** flows via
agent-browser). This drives the **iOS Simulator** with
[`agent-device`](https://www.npmjs.com/package/agent-device) against the live submission
pipeline. Same philosophy as the web suite: **the database is ground truth** — UI snapshots
are for navigation/form-filling only; every real assertion (was a submission queued? did it
complete? did a Post land?) goes through `psql` against the row, so a UI redesign never breaks
the test.

> Status legend: ✅ verified live · ◑ partially verified (sub-step proven) · ⏳ not yet run · 🚧 automation gap

## Prereqs

- `agent-device >= 0.14` on `PATH` (`agent-device --version`).
- iOS Simulator booted; the dev build of **`dev.copt.sirius`** installed (Sirius scheme `siriusapp`).
- `bun run dev` running from repo root (web on :3000 via portless `https://sirius.local`,
  Metro on :8081, **and the worker daemon** — submissions only move `pending → processing →
  completed` because the worker polls; check `ps aux | grep "src/index.ts"`).
- `psql` on `PATH`; repo `.env` populated (`DATABASE_URL`, `DEV_LOGIN_PASSWORD`, `GEMINI_API_KEY`).
- Dev user signed in (`saleebmina@icloud.com` / `$DEV_LOGIN_PASSWORD`), userId
  `OJGsrO3g3QY33Oaj6B59KhHbEQ6p4cGS`.

## One-time harness setup (CRITICAL)

**Disable the simulator keyboard's autocorrect/prediction before any text entry.** Without
this, typed URLs/text get a QuickType suggestion appended (e.g. `https://example.com` →
`https://example.com TV`) and tapping a "neutral" spot to blur lands on a suggestion chip and
inserts it — silently corrupting every form value.

```sh
DEV=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
xcrun simctl spawn "$DEV" defaults write -g KeyboardAutocorrection -bool false
xcrun simctl spawn "$DEV" defaults write -g KeyboardPrediction -bool false
xcrun simctl spawn "$DEV" defaults write -g KeyboardShowPredictionBar -bool false
xcrun simctl spawn "$DEV" defaults write -g KeyboardAutocapitalization -bool false
# relaunch the app afterward so the keyboard process picks it up
```

A `psql` helper (mirrors the web suite's `psql_q`):

```sh
set -a; source .env; set +a
PSQL_URL="${DATABASE_URL%%\?*}"          # strip ?schema= for psql
q(){ psql "$PSQL_URL" -tAc "$1"; }
UID_DEV=OJGsrO3g3QY33Oaj6B59KhHbEQ6p4cGS
```

## Locator preferences (most stable first)

1. **Accessibility label** — `agent-device press 'label="Add to tray"'`,
   `agent-device fill 'label="URLs (one per line)"' "..."`. Stable across redesigns. As of
   2026-06-19 every input is reachable this way: `Field`/`PasswordField` set
   `accessibilityLabel` from their visible label (falling back to the placeholder), and the
   keyboard-dismiss button's accessible name now matches its visible "Done" text.
2. **`@eN` refs** from a *fresh* `snapshot -i` — great for one-shot actions in a sequence, but
   regenerated every snapshot, so never reuse a ref across re-snapshots.
3. **Coordinates** — last resort only. Get rects from `snapshot -i -c --json` (each node has
   `rect:{x,y,width,height}`; center = `x+width/2, y+height/2`).

## Gotchas (the mistakes this runbook exists to prevent)

- **AgentDeviceRunner breadcrumb.** After some actions — especially a multiline `fill` — the
  `AgentDeviceRunner` helper app steals the foreground. Detect it: the first `snapshot -i`
  node is `[application] "AgentDeviceRunner"`. Recover by re-foregrounding
  (`agent-device open dev.copt.sirius --session s1 --platform ios`); **the typed text is
  preserved**. Practice: after every `fill`, check the foreground and re-open Sirius if needed
  before the next step.
- **Don't blur the keyboard by tapping a "neutral" coordinate.** On short sheets that
  coordinate lands on the **Close** button and discards the sheet. Dismiss with the app's
  button: `agent-device press 'label="Done"'`, or `agent-device keyboard dismiss`. Submit
  buttons live *below* the keyboard, so dismiss first.
- **Submit auto-navigates to the Queue tab.** After `Submit`, the app switches to Queue
  (handy: you can read the new row's status there). Re-tap `label="Capture"` for the next item.
- **Relaunch dance.** `agent-device open … --relaunch` may land on the expo-dev-client
  launcher ("DEVELOPMENT SERVERS"); tap the dev-server row (`label` contains
  `Sirius, http://<lan-ip>:8081`) to connect to Metro (first bundle build ~10–15 s). It often
  loads straight into the app instead — handle both.
- **Metro `reload` can 500.** Use a relaunch instead of `agent-device metro reload`.
- **`longpress` arg order is `<x> <y> <duration>`** (e.g. `longpress 201 195 700`).
- **JS-only code changes** need a relaunch to load the new bundle (Metro serves fresh JS on
  app launch); native changes need a rebuild.

## Critical-path coverage

### Auth (run last — disrupts the session)
| Case | Steps | Assert | Status |
| --- | --- | --- | --- |
| Sign-in (happy) | fill email field + password field → `label="Sign in"` | lands on Catalog; `session` row inserted | ✅ |
| Sign-in (invalid) | wrong password → `Sign in` | inline "Invalid email or password"; no new session | ⏳ |
| Sign-out | Capture → `label="Sign out"` | redirects to Sign in screen | ✅ 2026-06-18 (NOTE: inline Sign-out link being relocated out of the composer 2026-06-19 — re-point selector when it lands) |
| Forced-logout | `q "DELETE FROM session WHERE \"userId\"='$UID_DEV'"`, trigger any authed call | redirects to Sign in (not stranded) — see [[mobile-unauthorized-stale-cookie]] | ✅ |
| Session persistence | relaunch app | stays signed in (cookie in SecureStore) | ✅ |
| Sign-up | (auth) Create account → name/email/password → submit | `verify-pending`; user row created; flip `emailVerified=true` in DB to finish | ⏳ |
| Forgot-password | (auth) Forgot password → email → submit | confirmation UI; Resend send (testing mode may reject non-sender) | ⏳ |

### Capture / ingest
| Type | Verified steps | Assert | Status |
| --- | --- | --- | --- |
| **Link** | Capture → `label="Link"` → fill `label="URLs (one per line)"` `https://example.com` → `label="Done"` → `label="Add to tray"` → `label="Submit"` | `IngestSubmission` kind=url → **completed**; Post "… — Finding" | ✅ (`cmqk5xh1m…` → "The quiet minimalism of example.com") |
| **Note** | Capture → `label="Note"` → fill `label="Note"` → *re-foreground* → `label="Add to tray"` → `label="Submit"` | kind=note → **completed**; Post "… — Dispatch" | ✅ (`cmqk6djfv…` → "Testing the Mobile Ingestion Pipeline") |
| **Repository** | Capture → `label="Repository"` → fill `label="GitHub repository URL"` → `label="Fetch preview"` → preview card → `label="Add to tray"` → `label="Submit"` | preview = `POST /api/app/github/preview`; kind=url → completed | ◑ preview ✅ (colinhacks/zod ★43,006); final add-to-tray flaky under keyboard |
| **Photos** | Capture → `label="Photos"` → system PHPicker → select → `Add to tray` → `Submit` | kind=image batch → SIGHT post | ⏳ / 🚧 native picker |
| **Video** | Capture → `label="Video"` → PHPicker → select | kind=video → completed/failed terminal | ⏳ / 🚧 |
| **Document** | Capture → `label="Document"` → Files picker | kind=document | ⏳ / 🚧 |
| **Audio** | Capture → `label="Audio"` → `Record voice memo`/`Pick audio file` | kind=audio | ⏳ (in-app recorder is drivable) |
| Focus picker | Capture → `label="Focus: <name>"` before submit | submission `projectId` set | ⏳ |
| On-device AI link | Capture → `label="On-device AI →"` | navigates to `/llm` | ⏳ |

DB assertion after a submit:
```sh
q "SELECT id,kind,status FROM \"IngestSubmission\" WHERE \"submittedById\"='$UID_DEV' AND \"createdAt\">now()-interval '5 min' ORDER BY \"createdAt\" DESC;"
```

### Catalog ✅ (read paths)
| Case | Steps | Assert | Status |
| --- | --- | --- | --- |
| Library list | `label="Catalog"` | renders local-mirror posts + "N ON FILE" | ✅ (count 11→13 after 2 ingests) |
| Category facets | facet chips ("Software Development, 6" …) | render from scene | ✅ visible |
| Remote post detail | tap a post row | `/post/[slug]` via `GET /api/app/posts/[slug]`; title/type/tags render | ✅ ("The quiet minimalism…") |
| Local post detail | tap a draft/local post | `/post/local/[localId]` from SQLite | ⏳ |
| Delete post | post detail → Delete (or `DELETE /api/app/posts/[slug]`) | post + source rows + submission cascade-removed | ✅ (cleanup of 2 test posts → 200, rows gone) |
| Source / notes | post detail → Source / Notes | `/source`, `/notes` | ⏳ |
| Space (3D) | Catalog → `label="Enter the space →"` | `/space` scene renders nodes | ✅ (scene rendered) |

### Queue ◑
| Case | Steps | Assert | Status |
| --- | --- | --- | --- |
| List + statuses | `label="Queue"` | rows with URL/IMAGE + PENDING/PROCESSING/COMPLETED/FAILED | ✅ (saw URL example.com PROCESSING) |
| Auto-refetch (5 s) | wait on Queue | status advances without manual refresh | ◑ (rows advanced to completed) |
| Pull-to-refresh | swipe down on Queue | refetch | ⏳ |
| Retry | failed row → `label="Retry"` | re-enqueues | ⏳ |

### Tree ⏳
| Case | Steps | Assert |
| --- | --- | --- |
| Outline | `label="Tree"` | taxonomy outline renders (`GET /api/app/embedding-scene`) |
| Focus areas | "Focus areas" section | projects listed |
| Drill-in | tap a node | `/tree/[...node]` Index of posts |

### On-device AI ⏳
| Case | Steps | Assert |
| --- | --- | --- |
| LLM screen | Capture → `On-device AI →` | model status/download UI (`/llm`) |
| Draft bench | `/llm-test` | on-device draft generated (llama.rn) — see [[llama-rn-structured-output]] |

## Teardown / cleanup

Delete test posts + submissions created during a run (keep the user):
```sh
q "DELETE FROM \"IngestSubmission\" WHERE \"submittedById\"='$UID_DEV' AND \"createdAt\">'<run-start>';"
# delete resulting Posts via the app (DELETE /api/app/posts/[slug]) or by slug in DB.
```
