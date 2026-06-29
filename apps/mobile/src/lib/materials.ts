// A "material" is one extensible unit of shareable content. Both the composer
// and the OS share target normalize their inputs into Material[] and hand them
// to submitMaterials, which dispatches each kind through a handler registry.
// Adding support for a new shared content type (PDF, audio, etc.) is a local
// change: add a Material variant, teach materialsFromShareIntent to emit it,
// and register a handler below.
import type { ShareIntent } from "expo-share-intent";
import * as Crypto from "expo-crypto";

import { ApiError } from "@/lib/api";
import {
  fetchUrlExtract,
  formatError,
  type ImageInput,
  noteIngestBody,
  submitNote,
  submitUrl,
  type Visibility,
} from "@/lib/ingest-submit";
import {
  canDraftOnDevice,
  draftNotePost,
  draftSightPost,
  draftUrlPost,
} from "@/lib/llm/curate";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import { canTranscribeOnDevice, transcribeAudio } from "@/lib/llm/transcribe";
import {
  discardStagedCopy,
  enqueueAndSendBinary,
  enqueueOutbox,
} from "@/lib/outbox";
import {
  createLocalDraft,
  createLocalRawNote,
  deleteLocalDraft,
  linkSubmission,
  markLocalFailed,
} from "@/lib/sync/writes";

export type UrlMaterial = { kind: "url"; url: string; notes?: string };
// A GitHub repository link. Submitted exactly like a URL (the worker detects the
// github.com host and takes its dedicated structure+key-files path); kept as its
// own kind so the composer can show the server-fetched confirm-preview card and
// tag the tray row. All GitHub processing is server-side — no on-device draft.
export type RepoMaterial = { kind: "repo"; url: string; notes?: string };
export type NoteMaterial = { kind: "note"; text: string };
export type ImageMaterial = {
  kind: "image";
  uri: string;
  name: string;
  type: string;
  notes?: string;
};
// Reference-only file kinds: the worker feeds the bytes to Gemini for
// understanding but never stores/serves them. Each is one submission.
export type VideoMaterial = {
  kind: "video";
  uri: string;
  name: string;
  type: string;
  notes?: string;
};
export type AudioMaterial = {
  kind: "audio";
  uri: string;
  name: string;
  type: string;
  notes?: string;
};
export type DocumentMaterial = {
  kind: "document";
  uri: string;
  name: string;
  type: string;
  notes?: string;
};
// A recognized-but-not-yet-handled material. Surfaced to the user instead of
// being silently dropped, so the gap is visible and easy to fill later.
export type UnsupportedMaterial = {
  kind: "unsupported";
  label: string;
  reason: string;
};

export type Material =
  | UrlMaterial
  | RepoMaterial
  | NoteMaterial
  | ImageMaterial
  | VideoMaterial
  | AudioMaterial
  | DocumentMaterial
  | UnsupportedMaterial;

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s]+/i;

// True only for values we can actually ingest as a link. iOS routes some shares
// (notably Apple Notes) through the share intent's web-URL slot even when the
// payload is plain note text. Those must NOT be classified as `url`, or they
// fail the server's strict `.url()` validation and never import — so we gate the
// web-URL slot on real http(s) parseability and fall back to treating it as a
// note (raw text → BLOG) otherwise.
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Cap on URLs accepted from one "Add link" action, matching the server's
// tolerance for fan-out batches.
export const MAX_URLS_PER_BATCH = 200;

// Turns a free-text blob (one URL per line, or whitespace/comma separated) into
// deduplicated UrlMaterials. Shared by the composer's link input so URL parsing
// lives next to the other material constructors rather than in the screen.
export function urlMaterialsFromText(raw: string): {
  materials: UrlMaterial[];
  deduped: number;
  capped: number;
} {
  const seen = new Set<string>();
  const materials: UrlMaterial[] = [];
  let deduped = 0;
  let capped = 0;
  for (const candidate of raw.split(/[\n\r,\s]+/)) {
    const url = candidate.trim();
    if (url.length === 0) continue;
    if (seen.has(url)) {
      deduped++;
      continue;
    }
    seen.add(url);
    if (materials.length >= MAX_URLS_PER_BATCH) {
      capped++;
      continue;
    }
    materials.push({ kind: "url", url });
  }
  return { materials, deduped, capped };
}

function isImageMime(mime: string | undefined | null): boolean {
  return typeof mime === "string" && mime.toLowerCase().startsWith("image/");
}

function fileNameFor(path: string, fallback: string): string {
  const tail = path.split("/").pop();
  return tail && tail.length > 0 ? tail : fallback;
}

// Parse a single free-text string into materials: pull an embedded URL out if
// present (remainder becomes a note), otherwise the whole string is a note.
// Shared by the share-intent flow and the App Intent /capture screen.
export function materialsFromText(text: string): Material[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const materials: Material[] = [];
  const match = trimmed.match(URL_IN_TEXT_REGEX)?.[0];
  if (match) {
    materials.push({ kind: "url", url: match });
    const remainder = trimmed.replace(match, "").trim();
    if (remainder.length > 0) {
      materials.push({ kind: "note", text: remainder });
    }
  } else {
    materials.push({ kind: "note", text: trimmed });
  }
  return materials;
}

// Normalizes a raw share intent into an extensible list of materials. Order of
// checks is deliberate: explicit files first, then a web URL, then plain text.
export function materialsFromShareIntent(shareIntent: ShareIntent): Material[] {
  const materials: Material[] = [];
  const files = shareIntent.files ?? [];

  for (const [i, file] of files.entries()) {
    if (isImageMime(file.mimeType)) {
      materials.push({
        kind: "image",
        uri: file.path,
        name: fileNameFor(file.path, file.fileName || `shared-${i}.jpg`),
        type: file.mimeType || "image/jpeg",
      });
    } else {
      materials.push({
        kind: "unsupported",
        label: file.fileName || file.path,
        reason: `${file.mimeType || "file"} isn't supported yet`,
      });
    }
  }

  // Treat the web-URL slot as a real link only when it actually parses as
  // http(s). A non-URL value here (e.g. Apple Notes routing note text through
  // this slot) is folded into the note candidates below instead of being
  // submitted as a URL and rejected by the server's URL gate.
  const rawWebUrl = shareIntent.webUrl?.trim();
  const webUrl = rawWebUrl && isHttpUrl(rawWebUrl) ? rawWebUrl : undefined;
  if (webUrl) {
    materials.push({ kind: "url", url: webUrl });
  }

  // Plain-text candidates: the text slot, plus a web-URL slot value we just
  // declined to treat as a link. Dedup so an app that fills both slots with the
  // same content yields a single note.
  const noteCandidates = new Set<string>();
  const rawText = shareIntent.text?.trim();
  if (rawText) noteCandidates.add(rawText);
  if (rawWebUrl && !webUrl) noteCandidates.add(rawWebUrl);

  for (const text of noteCandidates) {
    // Skip text that's just the URL we already captured.
    if (webUrl && text.includes(webUrl)) continue;
    if (webUrl) {
      // We already have the link; the text is a note alongside it.
      materials.push({ kind: "note", text });
    } else {
      materials.push(...materialsFromText(text));
    }
  }

  return materials;
}

// Apply an optional note to every material: stamp it onto kinds that carry a
// `notes` field, and merge it into a note's text (its text IS the content).
export function applyNote(
  materials: Material[],
  note: string | undefined,
): Material[] {
  if (!note) return materials;
  return materials.map((m) => {
    if (m.kind === "note") {
      return { ...m, text: `${m.text}\n\nAuthor's notes: ${note}` };
    }
    if (m.kind === "unsupported") return m;
    return { ...m, notes: note };
  });
}

export function describeMaterial(material: Material): string {
  switch (material.kind) {
    case "url":
      return material.url;
    case "repo":
      return material.url;
    case "note":
      return material.text;
    case "image":
      return material.name;
    case "video":
      return material.name;
    case "audio":
      return material.name;
    case "document":
      return material.name;
    case "unsupported":
      return material.reason;
  }
}

export type SubmitContext = {
  force: boolean;
  projectId?: string;
  // Read visibility for the resulting Post(s), applied to every material in this
  // submit. Optional: undefined → the worker keeps the PRIVATE default (e.g. the
  // OS share target, which doesn't expose a picker).
  visibility?: Visibility;
  // Share-group audience for a GROUP-visibility submit. Non-empty IFF
  // visibility === "GROUP" (the composer's AudienceValue enforces the invariant);
  // the server validates ownership and drops them for any non-GROUP submit.
  shareGroupIds?: string[];
  // Draft notes (and transcribed audio) on-device with the local LLM before
  // submitting, so the worker skips its Gemini stage. The handlers re-check
  // model readiness themselves; this is the user's intent switch.
  onDeviceCuration?: boolean;
  onError?: (label: string, err: unknown) => void;
};

export type SubmitMaterialsResult = {
  submitted: number;
  errors: string[];
  skipped: UnsupportedMaterial[];
  // The exact material objects that failed to submit, by reference, so callers
  // can keep only the failures staged for retry and clear what succeeded.
  failed: Material[];
  // Materials the server already had (content-hash dedup): NO new submission was
  // created for these, so they neither queued work nor errored. Returned by
  // reference so a caller can offer a forced re-process (submit again with
  // force:true). Only url/note/repo dedup — image/file kinds carry a fresh
  // batchId/byte identity per share, so they never collide.
  deduped: Material[];
  // Note-kind materials captured while offline: parked in the on-device outbox
  // (flushed automatically later), so they're neither submitted nor failed.
  queued: number;
};

// A handler owns submission for one material kind. It receives every material
// of that kind at once so kinds that batch (images) can do so. `failed` returns
// the material objects (by reference) that didn't submit.
type MaterialHandler<K extends Material["kind"]> = {
  kind: K;
  submit: (
    materials: Extract<Material, { kind: K }>[],
    ctx: SubmitContext,
  ) => Promise<{
    submitted: number;
    errors: string[];
    failed: Extract<Material, { kind: K }>[];
    // Materials the server deduped (content already existed → no new row).
    // Returned by reference for an optional forced re-process. Absent means none.
    deduped?: Extract<Material, { kind: K }>[];
    // Parked in the offline outbox (note-kind only); absent means 0.
    queued?: number;
  }>;
};

// Multipart form fields for a GROUP-visibility binary submit. The multipart
// endpoints (/api/app/ingest-images, /api/app/ingest-file) read shareGroupIds as
// a JSON-encoded array STRING (the JSON-body /api/app/ingest takes a real array;
// see ingest-submit). Empty for any non-GROUP submit.
function shareGroupParam(ctx: SubmitContext): Record<string, string> {
  return ctx.visibility === "GROUP" && ctx.shareGroupIds?.length
    ? { shareGroupIds: JSON.stringify(ctx.shareGroupIds) }
    : {};
}

const urlHandler: MaterialHandler<"url"> = {
  kind: "url",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: UrlMaterial[] = [];
    const deduped: UrlMaterial[] = [];
    let submitted = 0;
    // Extraction/generation split: with curation on and a model ready, fetch
    // the de-identified page summary from the server, draft the FINDING
    // locally, and attach the envelope so the worker skips its Gemini stage.
    // Every step soft-fails to the plain submit (server drafts) — older
    // deploys without /api/app/extract, rate limits, Android model quirks,
    // or a bad extract can only ever cost the old behavior, never an error.
    const draftLocally =
      ON_DEVICE_AI_ENABLED &&
      ctx.onDeviceCuration === true &&
      materials.length > 0 &&
      (await canDraftOnDevice());
    for (const [i, m] of materials.entries()) {
      let draft;
      if (draftLocally) {
        const summary = await fetchUrlExtract([m.url]);
        draft = summary
          ? ((await draftUrlPost(summary, m.notes ?? "")) ?? undefined)
          : undefined;
      }
      // With an on-device draft, show it immediately as an optimistic FINDING.
      // (URL drafting needs the network extract, so this branch only runs
      // online; a later submit failure is therefore a real server error.)
      const localId = draft
        ? await createLocalDraft({ type: "FINDING", envelope: draft })
        : undefined;
      try {
        const ok = await submitUrl(
          m.url,
          m.notes ?? "",
          ctx.force,
          ctx.projectId,
          draft,
          ctx.visibility,
          ctx.shareGroupIds,
        );
        if (ok.deduped) {
          // Server already had this exact content (content-hash dedup) — it
          // created NO new submission. Drop the optimistic draft so we don't
          // leave an orphaned card, and report it so the caller can offer a
          // forced re-process instead of a misleading "queued" message.
          if (localId) await deleteLocalDraft(localId);
          deduped.push(m);
        } else {
          if (localId) await linkSubmission(localId, ok.id);
          submitted++;
        }
      } catch (err) {
        if (localId) await markLocalFailed(localId);
        const label = `URL ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed, deduped };
  },
};

const repoHandler: MaterialHandler<"repo"> = {
  kind: "repo",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: RepoMaterial[] = [];
    const deduped: RepoMaterial[] = [];
    let submitted = 0;
    // A repo is a URL submission — the worker's github.com detection routes it
    // to the dedicated structure+key-files path. No on-device drafting: per the
    // platform split, all GitHub processing happens server-side.
    for (const [i, m] of materials.entries()) {
      try {
        const ok = await submitUrl(
          m.url,
          m.notes ?? "",
          ctx.force,
          ctx.projectId,
          undefined,
          ctx.visibility,
          ctx.shareGroupIds,
        );
        // Server already had this repo (content-hash dedup) — nothing new was
        // created; report it for an optional forced re-process.
        if (ok.deduped) deduped.push(m);
        else submitted++;
      } catch (err) {
        const label = `Repo ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed, deduped };
  },
};

const noteHandler: MaterialHandler<"note"> = {
  kind: "note",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: NoteMaterial[] = [];
    const deduped: NoteMaterial[] = [];
    let submitted = 0;
    let queued = 0;
    // Resolve once per batch: model readiness doesn't change mid-submit.
    const draftLocally =
      ON_DEVICE_AI_ENABLED &&
      ctx.onDeviceCuration === true &&
      materials.length > 0 &&
      (await canDraftOnDevice());
    for (const [i, m] of materials.entries()) {
      // Drafting is fully local, so it works (and is attempted) even offline.
      const draft = draftLocally
        ? ((await draftNotePost(m.text)) ?? undefined)
        : undefined;
      // With an on-device draft, render it instantly as an optimistic BLOG. The
      // localId threads to the submission (or the offline outbox row) so the
      // server post reconciles back into this same card.
      const localId = draft
        ? await createLocalDraft({ type: "BLOG", envelope: draft })
        : undefined;
      try {
        const ok = await submitNote(
          m.text,
          ctx.force,
          ctx.projectId,
          draft,
          ctx.visibility,
          ctx.shareGroupIds,
        );
        if (ok.deduped) {
          // Identical note already submitted (content-hash dedup) — no new row.
          // Drop the optimistic draft and report it for an optional re-process.
          if (localId) await deleteLocalDraft(localId);
          deduped.push(m);
        } else {
          if (localId) await linkSubmission(localId, ok.id);
          submitted++;
        }
      } catch (err) {
        if (!(err instanceof ApiError)) {
          // No server response — offline or unreachable. Park the exact request
          // body in the outbox (tagged with localId so replay links the post);
          // it flushes when connectivity returns and the server's contentHash
          // dedup keeps retries idempotent. With an on-device draft the optimistic
          // row already exists; without one (curation off / model not ready) we
          // create a raw-note row from the text so the note still shows as
          // "Saved offline" instead of vanishing into the outbox until sync.
          const rowId = localId ?? (await createLocalRawNote(m.text));
          await enqueueOutbox(
            noteIngestBody(
              m.text,
              ctx.force,
              ctx.projectId,
              draft,
              ctx.visibility,
              ctx.shareGroupIds,
            ),
            rowId,
          );
          queued++;
          continue;
        }
        if (localId) await markLocalFailed(localId);
        const label = materials.length > 1 ? `Note ${i + 1}` : "Note";
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed, deduped, queued };
  },
};

const imageHandler: MaterialHandler<"image"> = {
  kind: "image",
  async submit(materials, ctx) {
    const errors: string[] = [];
    if (materials.length === 0) return { submitted: 0, errors, failed: [] };
    // One SIGHT post for the batch → one note. Join the DISTINCT non-empty
    // per-photo notes instead of silently keeping only the first; when every
    // image carries the same threaded global note the Set collapses it to one.
    const notes = Array.from(
      new Set(
        materials.map((m) => m.notes?.trim()).filter((n): n is string => !!n),
      ),
    ).join("\n\n");
    const inputs: ImageInput[] = materials.map((m) => ({
      uri: m.uri,
      name: m.name,
      type: m.type,
    }));
    const sightDraft =
      ON_DEVICE_AI_ENABLED && ctx.onDeviceCuration
        ? await draftSightPost(
            inputs.map((i) => i.uri),
            notes,
          )
        : null;
    const localId = sightDraft
      ? await createLocalDraft({
          type: "SIGHT",
          envelope: sightDraft,
          imageUris: inputs.map((i) => i.uri),
        })
      : Crypto.randomUUID();
    const batchId = Crypto.randomUUID();
    const draftJson = sightDraft ? JSON.stringify(sightDraft) : undefined;
    // Link the optimistic post to the batch up front: the worker only writes the
    // post once every row lands, so it stays `pending` until the batch completes
    // (including after an auto-resume / requeue), then reconciles into this card.
    if (sightDraft) await linkSubmission(localId, `batch:${batchId}`);

    let submitted = 0;
    let queued = 0;
    // Only ENQUEUE THROWS (no durable row created) land here, so the card can be
    // kept for retry. A `result === "failed"` row DOES exist and lives in the
    // In-flight section — that one is never re-staged (failed stays out of it).
    const failed: ImageMaterial[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const img = inputs[i]!;
      try {
        const result = await enqueueAndSendBinary({
          transport: "ingest-image",
          localId,
          localFilePath: img.uri,
          fieldName: "image",
          mimeType: img.type,
          parameters: {
            batchId,
            imageIndex: String(i),
            totalCount: String(inputs.length),
            notes,
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
            ...(ctx.visibility ? { visibility: ctx.visibility } : {}),
            ...shareGroupParam(ctx),
            ...(draftJson ? { draft: draftJson } : {}),
          },
          batchId,
          imageIndex: i,
          totalCount: inputs.length,
        });
        if (result === "sent") submitted++;
        else if (result === "deferred") queued++;
        else errors.push(`Image ${i + 1} failed — retry from the Queue.`);
      } catch {
        // No durable outbox row was created (insert/pre-upload threw). Keep this
        // image as a tray card so it isn't lost — matching the single-file
        // handlers and Spec B's durability invariant (tray card OR durable row).
        failed.push(materials[i]!);
        errors.push(
          `Image ${i + 1} couldn't be saved — kept in your tray so you can try again.`,
        );
      }
    }
    // `failed` holds ONLY enqueue-throw images (kept in the tray). Images that
    // returned "failed" have a durable row and live in the In-flight section.
    return { submitted, errors, failed, queued };
  },
};

// Generic single-file handlers (video/audio/document). Each material is one
// durable outbox row sent immediately; terminal failures persist as `failed`
// rows for Requeue — never re-staged in the tray.
const videoHandler: MaterialHandler<"video"> = {
  kind: "video",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: VideoMaterial[] = [];
    let submitted = 0;
    let queued = 0;
    for (const [i, m] of materials.entries()) {
      try {
        const result = await enqueueAndSendBinary({
          transport: "ingest-file",
          localId: Crypto.randomUUID(),
          localFilePath: m.uri,
          fieldName: "file",
          mimeType: m.type,
          parameters: {
            kind: "video",
            notes: m.notes ?? "",
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
            ...(ctx.visibility ? { visibility: ctx.visibility } : {}),
            ...shareGroupParam(ctx),
          },
        });
        if (result === "sent") submitted++;
        else if (result === "deferred") queued++;
        else errors.push(`Video ${i + 1} failed — retry from the Queue.`);
      } catch {
        // The durable outbox row was never created (the insert or a pre-upload
        // step threw). Keep this capture in the tray WITH feedback instead of a
        // silent short-circuit that drops it with no record and no retry path.
        failed.push(m);
        errors.push(
          `Video ${i + 1} couldn't be saved — kept in your tray so you can try again.`,
        );
      }
    }
    return { submitted, errors, failed, queued };
  },
};

const audioHandler: MaterialHandler<"audio"> = {
  kind: "audio",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: AudioMaterial[] = [];
    let submitted = 0;
    let queued = 0;
    // With curation on and Apple SpeechAnalyzer available (iOS 26+), audio is
    // transcribed and drafted entirely on device, then submitted as a NOTE —
    // the bytes never upload (matching the worker, which treats audio→BLOG as
    // text-only and never serves the file). Anywhere else, or on any failure,
    // the existing upload-to-Gemini path runs unchanged.
    const transcribeLocally =
      ctx.onDeviceCuration === true &&
      materials.length > 0 &&
      (await canTranscribeOnDevice());
    for (const [i, m] of materials.entries()) {
      const label = `Audio ${i + 1}/${materials.length}`;
      if (transcribeLocally) {
        const transcript = await transcribeAudio(m.uri);
        if (transcript) {
          const userNotes = m.notes?.trim();
          const noteText = userNotes
            ? `${transcript}\n\nAuthor's notes: ${userNotes}`
            : transcript;
          const draft = (await canDraftOnDevice())
            ? ((await draftNotePost(noteText)) ?? undefined)
            : undefined;
          const localId = draft
            ? await createLocalDraft({ type: "BLOG", envelope: draft })
            : undefined;
          try {
            const ok = await submitNote(
              noteText,
              ctx.force,
              ctx.projectId,
              draft,
              ctx.visibility,
              ctx.shareGroupIds,
            );
            if (localId) await linkSubmission(localId, ok.id);
            submitted++;
            await discardStagedCopy(m.uri);
            continue;
          } catch (err) {
            if (!(err instanceof ApiError)) {
              // Offline: the transcript (and draft) are text — park them in
              // the outbox like any other note (tagged with localId so replay
              // links the post). Fully offline voice memos.
              await enqueueOutbox(
                noteIngestBody(
                  noteText,
                  ctx.force,
                  ctx.projectId,
                  draft,
                  ctx.visibility,
                  ctx.shareGroupIds,
                ),
                localId,
              );
              queued++;
              await discardStagedCopy(m.uri);
              continue;
            }
            // Server rejected the note — discard the optimistic draft and fall
            // through to the upload path below (server will draft from the
            // audio) rather than leaving an orphaned card or losing the capture.
            if (localId) await deleteLocalDraft(localId);
          }
        }
      }
      try {
        const result = await enqueueAndSendBinary({
          transport: "ingest-file",
          localId: Crypto.randomUUID(),
          localFilePath: m.uri,
          fieldName: "file",
          mimeType: m.type,
          parameters: {
            kind: "audio",
            notes: m.notes ?? "",
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
            ...(ctx.visibility ? { visibility: ctx.visibility } : {}),
            ...shareGroupParam(ctx),
          },
        });
        if (result === "sent") submitted++;
        else if (result === "deferred") queued++;
        else errors.push(`${label} failed — retry from the Queue.`);
      } catch {
        // No durable outbox row was created — keep the capture with feedback.
        failed.push(m);
        errors.push(
          `${label} couldn't be saved — kept in your tray so you can try again.`,
        );
      }
    }
    return { submitted, errors, failed, queued };
  },
};

const documentHandler: MaterialHandler<"document"> = {
  kind: "document",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: DocumentMaterial[] = [];
    let submitted = 0;
    let queued = 0;
    for (const [i, m] of materials.entries()) {
      try {
        const result = await enqueueAndSendBinary({
          transport: "ingest-file",
          localId: Crypto.randomUUID(),
          localFilePath: m.uri,
          fieldName: "file",
          mimeType: m.type,
          parameters: {
            kind: "document",
            notes: m.notes ?? "",
            ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
            ...(ctx.visibility ? { visibility: ctx.visibility } : {}),
            ...shareGroupParam(ctx),
          },
        });
        if (result === "sent") submitted++;
        else if (result === "deferred") queued++;
        else errors.push(`Document ${i + 1} failed — retry from the Queue.`);
      } catch {
        // No durable outbox row was created — keep the capture with feedback.
        failed.push(m);
        errors.push(
          `Document ${i + 1} couldn't be saved — kept in your tray so you can try again.`,
        );
      }
    }
    return { submitted, errors, failed, queued };
  },
};

const HANDLERS = {
  url: urlHandler,
  repo: repoHandler,
  note: noteHandler,
  image: imageHandler,
  video: videoHandler,
  audio: audioHandler,
  document: documentHandler,
} satisfies {
  [K in Exclude<Material["kind"], "unsupported">]: MaterialHandler<K>;
};

function groupByKind(materials: Material[]) {
  return {
    url: materials.filter((m): m is UrlMaterial => m.kind === "url"),
    repo: materials.filter((m): m is RepoMaterial => m.kind === "repo"),
    note: materials.filter((m): m is NoteMaterial => m.kind === "note"),
    image: materials.filter((m): m is ImageMaterial => m.kind === "image"),
    video: materials.filter((m): m is VideoMaterial => m.kind === "video"),
    audio: materials.filter((m): m is AudioMaterial => m.kind === "audio"),
    document: materials.filter(
      (m): m is DocumentMaterial => m.kind === "document",
    ),
    unsupported: materials.filter(
      (m): m is UnsupportedMaterial => m.kind === "unsupported",
    ),
  };
}

export async function submitMaterials(
  materials: Material[],
  ctx: SubmitContext,
): Promise<SubmitMaterialsResult> {
  const grouped = groupByKind(materials);
  const errors: string[] = [];
  const failed: Material[] = [];
  const deduped: Material[] = [];
  let submitted = 0;
  let queued = 0;

  const urlResult = await HANDLERS.url.submit(grouped.url, ctx);
  submitted += urlResult.submitted;
  errors.push(...urlResult.errors);
  failed.push(...urlResult.failed);
  deduped.push(...(urlResult.deduped ?? []));

  const repoResult = await HANDLERS.repo.submit(grouped.repo, ctx);
  submitted += repoResult.submitted;
  errors.push(...repoResult.errors);
  failed.push(...repoResult.failed);
  deduped.push(...(repoResult.deduped ?? []));

  const noteResult = await HANDLERS.note.submit(grouped.note, ctx);
  submitted += noteResult.submitted;
  errors.push(...noteResult.errors);
  failed.push(...noteResult.failed);
  deduped.push(...(noteResult.deduped ?? []));
  queued += noteResult.queued ?? 0;

  const imageResult = await HANDLERS.image.submit(grouped.image, ctx);
  submitted += imageResult.submitted;
  errors.push(...imageResult.errors);
  failed.push(...imageResult.failed);
  deduped.push(...(imageResult.deduped ?? []));
  queued += imageResult.queued ?? 0;

  const videoResult = await HANDLERS.video.submit(grouped.video, ctx);
  submitted += videoResult.submitted;
  errors.push(...videoResult.errors);
  failed.push(...videoResult.failed);
  deduped.push(...(videoResult.deduped ?? []));
  queued += videoResult.queued ?? 0;

  const audioResult = await HANDLERS.audio.submit(grouped.audio, ctx);
  submitted += audioResult.submitted;
  errors.push(...audioResult.errors);
  failed.push(...audioResult.failed);
  deduped.push(...(audioResult.deduped ?? []));
  queued += audioResult.queued ?? 0;

  const documentResult = await HANDLERS.document.submit(grouped.document, ctx);
  submitted += documentResult.submitted;
  errors.push(...documentResult.errors);
  failed.push(...documentResult.failed);
  deduped.push(...(documentResult.deduped ?? []));
  queued += documentResult.queued ?? 0;

  return {
    submitted,
    errors,
    skipped: grouped.unsupported,
    failed,
    deduped,
    queued,
  };
}
