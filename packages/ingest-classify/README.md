# @repo/ingest-classify

The single, pure, host-agnostic **classification module** for the omni-ingest
composer. Both UI hosts — the web composer (`apps/web/app/(app)/ingest`) and the
mobile Capture tab (`apps/mobile`) — consume this package so they classify,
validate, override, and dedup tray items **identically**.

Mirrors the pure-package pattern of `@repo/embedding-scene` and
`@repo/ingest-draft`: one `"."` export, no React, no DOM-only or Node-only APIs,
operates on plain data.

## Boundary (read this first)

This package decides **DISPLAY + PRE-SUBMIT VALIDATION ONLY**. It is a UX
affordance and a client-side pre-flight check. It **never** decides the final
post type. The worker re-detects platform/host independently and **forces** the
final `PostType` (FINDING / SIGHT / BLOG) server-side. The `platform` sub-label
("Repository" / "Instagram" / "YouTube" / "X" / "Link") is a cosmetic badge +
user hint, never trusted for routing. Submission kinds remain the fixed 6-kind
enum (`url | image | note | video | audio | document`) from
`packages/db/src/ingest.ts` — `IngestKind` here is asserted equal to it at
compile time (see `src/types.ts`).

## Public surface

```ts
import {
  classifyInput, // text string OR FileDescriptor(s) -> ClassifiedItem[]
  classifyText, // pasted/typed blob -> { items, deduped, capped }
  classifyFile, // one FileDescriptor -> one ClassifiedItem
  classifyUrl, // MIGRATED from materials.ts (single source of truth)
  validateItem, // ClassifiedItem -> InlineError[]
  overrideKind, // legal-transition apply (throws on illegal)
  canOverride, // (from, to) -> boolean (OVERRIDE_MATRIX gate)
  dedupKey, // ClassifiedItem -> stable in-tray dedup key
  DUP_KEY, // alias of dedupKey
  // typed constants
  OVERRIDE_MATRIX,
  ACCEPTED_MIME,
  MAX_URLS, // 200
  MAX_IMAGE_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_VIDEO_BYTES,
  MAX_AUDIO_BYTES,
  MAX_FILE_BYTES, // per-kind cap lookup
  // helpers
  platformFor,
  isHttpUrl,
  fileKind,
} from "@repo/ingest-classify";
```

### Decision order

- **Text** (`classifyText`): tokenize on whitespace/newline **or** comma; each
  `http(s)://` token becomes a `url` card (with a platform sub-label); all
  remaining non-URL prose is reassembled in original order into **exactly one**
  `note` card. Bare domains (no scheme, e.g. `example.com`) are **note**, not
  url (resolved decision O-3) — override to Link to treat as a URL. URL cards
  dedup within the paste and cap at `MAX_URLS` (200).
- **Files** (`classifyFile`): route by MIME first, extension fallback when the
  MIME is blank/`application/octet-stream`. `image/* → image`, `video/* →
  video`, `audio/* → audio`, PDF/`.doc`/`.docx` → `document`. Anything else →
  an error card (`file_unsupported`, critical).

### Validation (`validateItem`)

Returns `InlineError[]`. `severity: "critical"` blocks submit; `severity:
"warn"` does not.

| code | severity | when |
|---|---|---|
| `url_invalid` | critical | url card content is not an http(s) URL |
| `url_suspicious` | warn | parses but host empty / `localhost` / IP-only |
| `note_empty` | critical | note empty after trim |
| `file_unsupported` | critical | MIME+ext not in the accepted set |
| `file_too_large` | **warn** | size over the advisory cap (O-1) |
| `duplicate` | warn | host-derived in-tray duplicate (host sets this via `dedupKey`) |

File-size caps (resolved decision O-1) are **advisory WARN-only** — they do not
block submit. Defaults: 50 MB image/document, 200 MB video/audio. The UI renders
the human-readable cap in the copy.

### Override matrix (`OVERRIDE_MATRIX`, resolved decision O-5)

Same-endpoint groups only:

| from \ to | url | note | image | video | audio | document |
|---|---|---|---|---|---|---|
| **url** | self | YES | NO | NO | NO | NO |
| **note** | YES | self | NO | NO | NO | NO |
| **image** | NO | NO | self | NO | NO | NO |
| **video** | NO | NO | NO | self | YES | YES |
| **audio** | NO | NO | NO | YES | self | YES |
| **document** | NO | NO | NO | YES | YES | self |

- Text cards (`url ⇄ note`) swap freely (both are text content).
- File cards interchange only within their submit-endpoint group:
  `video ⇄ audio ⇄ document` (all `/api/app/ingest-file`). **Image is isolated**
  (`/api/app/ingest-images`) — image cannot become video/audio/document and they
  cannot become image.
- File → url and file → note are always illegal (no text to put there).

## FileDescriptor adapter contract

The pure core never touches a real `File`/asset. Hosts adapt their native file
object into a `FileDescriptor` and keep the real bytes themselves, keyed by the
returned `ClassifiedItem.id`:

```ts
// web (DOM File)
const desc: FileDescriptor = {
  name: file.name,
  mimeType: file.type, // may be "" — extension fallback handles it
  size: file.size,
  ref: file, // opaque; host retrieves at submit
};

// mobile (Expo / RN asset { uri, name, mimeType|type, size })
const desc: FileDescriptor = {
  name: asset.name ?? uriBasename(asset.uri),
  mimeType: asset.mimeType ?? asset.type ?? "",
  size: asset.size ?? 0,
  ref: asset, // or { uri }
};
```

At submit, the host reads `item.id`, looks up its stored `ref`, and builds the
existing `Material` for `submitMaterials()` (web) / the mobile equivalent. The
submit pipeline, endpoints, worker, and DB schema are unchanged.

## materials.ts migration

`classifyUrl()` (and its `ParsedUrl` type, Instagram/X/other/invalid matchers)
previously lived in `apps/web/app/(app)/ingest/materials.ts`. They now live here
as the single source of truth; `materials.ts` keeps a **re-export shim** with the
identical symbol names + signatures so every existing caller compiles unchanged.
The richer `platformFor()` (adds `repository` + `youtube` sub-labels) is the
preferred entry point for new code.

## Bundler notes (mobile)

- Pure ESM TS, no React/DOM/Node APIs. Metro bundles it like any workspace
  package.
- The only `import` of `@repo/db` is a **type-only** import in `src/types.ts`
  (the compile-time enum-equality fence). It is fully erased by tsc/Metro and
  never pulls Prisma into the mobile bundle.
- `crypto.randomUUID()` is used for item ids — available on web, Bun/Node 19+,
  and Hermes (RN). No polyfill needed on the supported targets.
