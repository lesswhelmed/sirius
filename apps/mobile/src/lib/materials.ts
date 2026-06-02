// A "material" is one extensible unit of shareable content. Both the composer
// and the OS share target normalize their inputs into Material[] and hand them
// to submitMaterials, which dispatches each kind through a handler registry.
// Adding support for a new shared content type (PDF, audio, etc.) is a local
// change: add a Material variant, teach materialsFromShareIntent to emit it,
// and register a handler below.
import type { ShareIntent } from "expo-share-intent";

import {
  formatError,
  submitFile,
  submitImageBatch,
  submitNote,
  submitUrl,
  type ImageInput,
} from "@/lib/ingest-submit";

export type UrlMaterial = { kind: "url"; url: string; notes?: string };
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
  | NoteMaterial
  | ImageMaterial
  | VideoMaterial
  | AudioMaterial
  | DocumentMaterial
  | UnsupportedMaterial;

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s]+/i;

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

// Normalizes a raw share intent into an extensible list of materials. Order of
// checks is deliberate: explicit files first, then a web URL, then plain text.
export function materialsFromShareIntent(
  shareIntent: ShareIntent
): Material[] {
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

  const webUrl = shareIntent.webUrl?.trim();
  if (webUrl) {
    materials.push({ kind: "url", url: webUrl });
  }

  const text = shareIntent.text?.trim();
  if (text && (!webUrl || !text.includes(webUrl))) {
    // Text that isn't just the already-captured URL. Pull an embedded URL if
    // present, otherwise treat the whole thing as a note.
    const match = !webUrl ? text.match(URL_IN_TEXT_REGEX)?.[0] : undefined;
    if (match) {
      materials.push({ kind: "url", url: match });
      const remainder = text.replace(match, "").trim();
      if (remainder.length > 0) {
        materials.push({ kind: "note", text: remainder });
      }
    } else {
      materials.push({ kind: "note", text });
    }
  }

  return materials;
}

export function describeMaterial(material: Material): string {
  switch (material.kind) {
    case "url":
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
  onError?: (label: string, err: unknown) => void;
};

export type SubmitMaterialsResult = {
  submitted: number;
  errors: string[];
  skipped: UnsupportedMaterial[];
  // The exact material objects that failed to submit, by reference, so callers
  // can keep only the failures staged for retry and clear what succeeded.
  failed: Material[];
};

// A handler owns submission for one material kind. It receives every material
// of that kind at once so kinds that batch (images) can do so. `failed` returns
// the material objects (by reference) that didn't submit.
type MaterialHandler<K extends Material["kind"]> = {
  kind: K;
  submit: (
    materials: Extract<Material, { kind: K }>[],
    ctx: SubmitContext
  ) => Promise<{
    submitted: number;
    errors: string[];
    failed: Extract<Material, { kind: K }>[];
  }>;
};

const urlHandler: MaterialHandler<"url"> = {
  kind: "url",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: UrlMaterial[] = [];
    let submitted = 0;
    for (const [i, m] of materials.entries()) {
      try {
        await submitUrl(m.url, m.notes ?? "", ctx.force, ctx.projectId);
        submitted++;
      } catch (err) {
        const label = `URL ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed };
  },
};

const noteHandler: MaterialHandler<"note"> = {
  kind: "note",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: NoteMaterial[] = [];
    let submitted = 0;
    for (const [i, m] of materials.entries()) {
      try {
        await submitNote(m.text, ctx.force, ctx.projectId);
        submitted++;
      } catch (err) {
        const label = materials.length > 1 ? `Note ${i + 1}` : "Note";
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed };
  },
};

const imageHandler: MaterialHandler<"image"> = {
  kind: "image",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const notes = materials.find((m) => m.notes)?.notes ?? "";
    const inputs: ImageInput[] = materials.map((m) => ({
      uri: m.uri,
      name: m.name,
      type: m.type,
    }));
    const { submitted, failedIndices } = await submitImageBatch(
      inputs,
      notes,
      (label, err) => {
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
      },
      ctx.projectId
    );
    const failed = failedIndices
      .map((i) => materials[i])
      .filter((m): m is ImageMaterial => m !== undefined);
    return { submitted, errors, failed };
  },
};

// Generic single-file handlers (video/audio/document). Each material is one
// submission posted to the file-ingest endpoint; the worker forces the
// PostType per kind (video→SIGHT, audio→BLOG, document→FINDING).
const videoHandler: MaterialHandler<"video"> = {
  kind: "video",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: VideoMaterial[] = [];
    let submitted = 0;
    for (const [i, m] of materials.entries()) {
      try {
        await submitFile(
          m.uri,
          "video",
          m.type,
          m.name,
          m.notes ?? "",
          ctx.projectId
        );
        submitted++;
      } catch (err) {
        const label = `Video ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed };
  },
};

const audioHandler: MaterialHandler<"audio"> = {
  kind: "audio",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: AudioMaterial[] = [];
    let submitted = 0;
    for (const [i, m] of materials.entries()) {
      try {
        await submitFile(
          m.uri,
          "audio",
          m.type,
          m.name,
          m.notes ?? "",
          ctx.projectId
        );
        submitted++;
      } catch (err) {
        const label = `Audio ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed };
  },
};

const documentHandler: MaterialHandler<"document"> = {
  kind: "document",
  async submit(materials, ctx) {
    const errors: string[] = [];
    const failed: DocumentMaterial[] = [];
    let submitted = 0;
    for (const [i, m] of materials.entries()) {
      try {
        await submitFile(
          m.uri,
          "document",
          m.type,
          m.name,
          m.notes ?? "",
          ctx.projectId
        );
        submitted++;
      } catch (err) {
        const label = `Document ${i + 1}/${materials.length}`;
        ctx.onError?.(label, err);
        errors.push(formatError(err, label));
        failed.push(m);
      }
    }
    return { submitted, errors, failed };
  },
};

const HANDLERS = {
  url: urlHandler,
  note: noteHandler,
  image: imageHandler,
  video: videoHandler,
  audio: audioHandler,
  document: documentHandler,
} satisfies { [K in Exclude<Material["kind"], "unsupported">]: MaterialHandler<K> };

function groupByKind(materials: Material[]) {
  return {
    url: materials.filter((m): m is UrlMaterial => m.kind === "url"),
    note: materials.filter((m): m is NoteMaterial => m.kind === "note"),
    image: materials.filter((m): m is ImageMaterial => m.kind === "image"),
    video: materials.filter((m): m is VideoMaterial => m.kind === "video"),
    audio: materials.filter((m): m is AudioMaterial => m.kind === "audio"),
    document: materials.filter(
      (m): m is DocumentMaterial => m.kind === "document"
    ),
    unsupported: materials.filter(
      (m): m is UnsupportedMaterial => m.kind === "unsupported"
    ),
  };
}

export async function submitMaterials(
  materials: Material[],
  ctx: SubmitContext
): Promise<SubmitMaterialsResult> {
  const grouped = groupByKind(materials);
  const errors: string[] = [];
  const failed: Material[] = [];
  let submitted = 0;

  const urlResult = await HANDLERS.url.submit(grouped.url, ctx);
  submitted += urlResult.submitted;
  errors.push(...urlResult.errors);
  failed.push(...urlResult.failed);

  const noteResult = await HANDLERS.note.submit(grouped.note, ctx);
  submitted += noteResult.submitted;
  errors.push(...noteResult.errors);
  failed.push(...noteResult.failed);

  const imageResult = await HANDLERS.image.submit(grouped.image, ctx);
  submitted += imageResult.submitted;
  errors.push(...imageResult.errors);
  failed.push(...imageResult.failed);

  const videoResult = await HANDLERS.video.submit(grouped.video, ctx);
  submitted += videoResult.submitted;
  errors.push(...videoResult.errors);
  failed.push(...videoResult.failed);

  const audioResult = await HANDLERS.audio.submit(grouped.audio, ctx);
  submitted += audioResult.submitted;
  errors.push(...audioResult.errors);
  failed.push(...audioResult.failed);

  const documentResult = await HANDLERS.document.submit(grouped.document, ctx);
  submitted += documentResult.submitted;
  errors.push(...documentResult.errors);
  failed.push(...documentResult.failed);

  return { submitted, errors, skipped: grouped.unsupported, failed };
}
