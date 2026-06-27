# Content-safety guardrails

A decoupled Gemini gate that scans **user-produced** material **before any post is
created** and, on a reasonable harm signal, rejects it: no post, original
quarantined as evidence, admin alerted, and the item removed from the user's app.

The gate is a distinct pipeline stage that only ever *prevents* a post — the
existing happy path is unchanged when the content is in-scope-and-allowed,
out-of-scope, or the gate is disabled.

## What gets scanned (material list)

`PipelineInput.kind` ∈ `url | note | image | video | audio | document`.

| Material | `kind` | Scanned? | How |
|---|---|---|---|
| Note (free text) | `note` | **yes** | text → classifier |
| Image upload(s) → SIGHT | `image` | **yes** | image parts (multimodal) |
| Document upload (PDF/doc) | `document` | **yes** | file part |
| Audio upload | `audio` | **yes** | file part |
| Video upload | `video` | **yes** | file part |
| **PDF linked by URL** | `url` → PDF | **yes** | fetch the PDF bytes (size-capped) → file part |
| Author notes on ANY submission | any | **yes** | text → classifier |
| General article URL | `url` | no | third-party published content |
| YouTube link | `url` | no | third-party |
| Instagram / X / GitHub link | `url` | no | third-party (dedicated runners) |

`shouldScan()` (`apps/worker/src/pipeline/safety/targets.ts`) is the cheap
synchronous pre-gate; `collectScanTargets()` builds the actual parts (and does the
PDF HEAD-check + size-capped download). Known limitation: a content-type-only PDF
linked by a URL **without** a `.pdf` extension and **without** notes is not
fetched (we don't HEAD every link).

## How harmful content is handled

```
submission (pending) ──claim──► processing ──► shouldScan? ──no──► draft → post
                                                   │ yes
                                                   ▼
                                            SAFETY GATE (Gemini Flash-Lite)
                                            returns {safe,severity,categories}
                                          ┌──────────┴───────────┐
                                       allow                  flag / flag_critical
                                          │                       │
                                   draft → post            FLAG PROTOCOL (no post):
                                                            • markFlagged (terminal)
                                                            • quarantine original (evidence)
                                                            • recordModerationEvent (audit)
                                                            • email admin (Resend)
                                                            • notify device → drop optimistic row
   scan model error ──► retry ──► still failing ──► markFailed (RETRYABLE; never publishes)
```

### Severity → action (`policy.ts`)

| Signal | Action |
|---|---|
| any `child_safety` category | **flag_critical** (always, regardless of severity) |
| model severity `critical` | **flag_critical** |
| severity ≥ `SAFETY_BLOCK_SEVERITY` (default `medium`) | **flag** |
| below threshold | **allow** (the `safe` boolean is advisory; severity gates) |
| scan model error (Gemini down) | **fail, retryable** — fail-closed, never publishes unscanned |

The classifier call sets `safetySettings: BLOCK_NONE` on the *configurable*
categories **on purpose** — we need it to read and judge harmful content. CSAM is
still blocked by Google's *non-configurable* filter; if that trips
(`finishReason: content-filter`), we treat it as a critical `child_safety` verdict
(`providerBlockedVerdict`). The **draft** call keeps `BLOCK_ONLY_HIGH` as
defense-in-depth (`gemini-runner.ts`); a refusal there routes to a flag.

### Removing the item from the phone

Mobile inserts an optimistic local post on capture. A flagged submission produces
no post, so it can't ride the normal post-delta feed. Two converging paths drop
the local row (`removeLocalBySubmissionId`, idempotent → one-time neutral notice):

- **SSE fast-path** — the worker NOTIFYs `submissions_channel`; the web SSE route
  relays a `submission-rejected` event with the reconciliation key; the device
  removes that row instantly.
- **Queue-poll baseline** (offline-tolerant) — the 5s `/api/app/queue` poll
  returns the `flagged` submission; `reconcileRejectedSubmissions` drops the row.

The reconciliation key matches `posts.submissionId`: an image batch is
`batch:<batchId>` (not the per-row id) — the worker sends `sourceRecordIdFor(rows)`.

## Admin protocol (v1)

On a flag the admin (`SAFETY_ALERT_EMAIL`, default `saleebmina@copt.dev`) gets a
severity-tiered email. The original is moved to `QUARANTINE_DIR` (outside any
served directory, **kept** as evidence) and a `ModerationEvent` row records the
verdict. There is no review dashboard and no auto-suspend in v1; review is manual
and out-of-band.

**Child-safety / CSAM (CRITICAL):** the evidence is on **legal hold** — do NOT
delete the quarantined files or the `ModerationEvent`. Review and, if it is CSAM,
follow the documented reporting obligation (e.g. NCMEC in the US) **manually**.
This system never auto-reports.

To overturn a false positive: set the `ModerationEvent.resolution = overturn`
(out-of-band); re-enqueue is manual.

## Configuration

See `.env.example` (`SAFETY_*`, `QUARANTINE_DIR`). Master kill switch:
`SAFETY_SCAN_ENABLED=false` bypasses the gate entirely. `QUARANTINE_DIR` MUST live
outside `apps/web/public` and must never be fronted by Caddy.

## Verification

```sh
# pure logic (deterministic, no network)
bun --cwd apps/worker test src/pipeline/safety/

# live classifier suite (real Gemini; benign→allow, synthetic-harmful→flag)
bun --cwd apps/worker run safety:try
bun --cwd apps/worker run safety:try --note "some text to classify"
```

Code: `apps/worker/src/pipeline/safety/` (gate), `apps/worker/src/index.ts`
(`handleSafetyFlag`), `packages/db/src/ingest.ts` (`markFlagged`,
`recordModerationEvent`), `packages/db/src/notify.ts` (`SUBMISSIONS_CHANNEL`),
`apps/mobile/src/lib/sync/rejected.ts` (device removal).
