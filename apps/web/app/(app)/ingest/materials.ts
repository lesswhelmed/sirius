// Client-side mirror of the mobile composer's material model
// (apps/mobile/src/lib/{materials.ts,material-kinds.ts}), adapted to the
// browser's File/Blob. A "material" is one extensible unit of capturable
// content: the composer normalizes every card/sheet/file-input into Material[]
// and hands them to submitMaterials, which dispatches each kind to the existing
// web ingest endpoints. Adding a new capturable kind is a local change here
// (a Material variant + a CAPTURE_KINDS entry + a submit branch) without
// reworking the composer screen.

export type UrlMaterial = { kind: "url"; url: string; notes?: string };
// A GitHub repository link. Submitted exactly like a URL (the worker detects the
// github.com host and takes its dedicated structure+key-files path); kept as its
// own kind so the composer can show the confirm-preview repo card and tag it.
export type RepoMaterial = { kind: "repo"; url: string; notes?: string };
export type NoteMaterial = { kind: "note"; text: string };
export type ImageMaterial = {
  kind: "image";
  file: File | Blob;
  name: string;
  type: string;
  notes?: string;
};
// Reference-only file kinds: the worker feeds the bytes to Gemini for
// understanding but never stores/serves them. Each is one submission.
export type VideoMaterial = {
  kind: "video";
  file: File | Blob;
  name: string;
  type: string;
  notes?: string;
};
export type AudioMaterial = {
  kind: "audio";
  file: File | Blob;
  name: string;
  type: string;
  notes?: string;
};
export type DocumentMaterial = {
  kind: "document";
  file: File | Blob;
  name: string;
  type: string;
  notes?: string;
};

export type Material =
  | UrlMaterial
  | RepoMaterial
  | NoteMaterial
  | ImageMaterial
  | VideoMaterial
  | AudioMaterial
  | DocumentMaterial;

export type MaterialKind = Material["kind"];

// ── Capture-kind registry ────────────────────────────────────────────────────
// The UI-side mirror of the dispatch in submitMaterials: each entry is one card
// in the "What are you adding?" grid. Glyph fallbacks match the mobile registry
// (material-kinds.ts): ↗ ✎ ▦ ▶ 📄 🎙.

export type CaptureKindKey =
  | "link"
  | "repo"
  | "note"
  | "photos"
  | "video"
  | "document"
  | "audio";

export type CaptureKind = {
  key: CaptureKindKey;
  label: string;
  glyph: string;
  // VoiceOver/screen-reader hint describing what activating the card does.
  hint: string;
};

export const CAPTURE_KINDS: CaptureKind[] = [
  {
    key: "link",
    label: "Link",
    glyph: "↗",
    hint: "Add one or more web links to the tray",
  },
  {
    key: "repo",
    label: "Repository",
    glyph: "◆",
    hint: "Paste a GitHub repo URL, preview it, and add it to the tray",
  },
  {
    key: "note",
    label: "Note",
    glyph: "✎",
    hint: "Write a text note and add it to the tray",
  },
  {
    key: "photos",
    label: "Photos",
    glyph: "▦",
    hint: "Pick photos and add them to the tray",
  },
  {
    key: "video",
    label: "Video",
    glyph: "▶",
    hint: "Pick a video and add it to the tray",
  },
  {
    key: "document",
    label: "Document",
    glyph: "📄",
    hint: "Pick a PDF or Word document and add it to the tray",
  },
  {
    key: "audio",
    label: "Audio",
    glyph: "🎙",
    hint: "Record a voice memo or pick an audio file and add it to the tray",
  },
];

// Short mono tag shown on each staged tray row.
const TRAY_TAGS: Record<MaterialKind, string> = {
  url: "URL",
  repo: "REPO",
  note: "NOTE",
  image: "PHOTO",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOC",
};

export function trayTag(material: Material): string {
  return TRAY_TAGS[material.kind] ?? material.kind.toUpperCase();
}

export function describeMaterial(material: Material): string {
  switch (material.kind) {
    case "url":
    case "repo":
      return material.url;
    case "note":
      return material.text;
    case "image":
    case "video":
    case "audio":
    case "document":
      return material.name;
  }
}

// ── URL parsing ──────────────────────────────────────────────────────────────
// `classifyUrl` (+ its `ParsedUrl` type and the IG/X matchers) MIGRATED to the
// shared pure package `@repo/ingest-classify`, which is now the single source of
// truth so the web composer and the mobile Capture tab classify identically.
// Re-exported here with the identical symbol names + signatures so every
// existing caller (composer URL preview, etc.) keeps compiling unchanged.
export { classifyUrl } from "@repo/ingest-classify";
export type { ParsedUrl } from "@repo/ingest-classify";

// Cap on URLs accepted from one "Add link" action, matching the server's
// tolerance for fan-out batches (mirrors mobile MAX_URLS_PER_BATCH).
export const MAX_URLS_PER_BATCH = 200;

// Turns a free-text blob (one URL per line, or whitespace/comma separated) into
// deduplicated UrlMaterials. Shared by the composer's link sheet so URL parsing
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

// ── Submission ───────────────────────────────────────────────────────────────
// Dispatch each material by kind to the existing session-auth web endpoints.
// Every call uses credentials:"include" so the better-auth cookie rides along.

// One per-item outcome the composer renders as a status pill.
export type PillKind = "queued" | "retrying" | "deduped" | "error" | "invalid";

export type SubmitOutcome = {
  kind: PillKind;
  label: string;
};

// Read visibility for the resulting Post, chosen once per compose session and
// applied to every material in the tray (mirrors projectId). Matches the
// PostVisibility enum values the server validates.
export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";

export type SubmitContext = {
  force: boolean;
  projectId: string | null;
  visibility: Visibility;
};

interface IngestResponse {
  id?: string;
  status?: string;
  reason?: string;
  error?: string;
  deduped?: boolean;
  retried?: boolean;
}

function id8(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

// Map a successful ingest response to its pill kind. `retried` wins over
// `deduped`: a re-submit of a previously-failed item requeued it for the worker,
// so it's freshly queued — not a no-op duplicate.
function pillFor(data: IngestResponse): "queued" | "retrying" | "deduped" {
  if (data.retried) return "retrying";
  return data.deduped ? "deduped" : "queued";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "network";
}

// One URL becomes its own submission so the worker's dedicated IG / YT paths
// fire per-URL. A single submission with N urls gets routed to the generic
// url_context summarizer and collapses everything into one post.
async function submitUrl(
  material: UrlMaterial,
  label: string,
  { force, projectId, visibility }: SubmitContext,
): Promise<SubmitOutcome> {
  try {
    const res = await fetch("/api/app/ingest", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: [material.url],
        notes: material.notes ?? "",
        force,
        visibility,
        ...(projectId ? { projectId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as IngestResponse;
    if (!res.ok) {
      return {
        kind: "error",
        label: `${label} · error · ${data.error ?? data.reason ?? String(res.status)}`,
      };
    }
    const short = data.id ? id8(data.id) : "";
    const status = pillFor(data);
    return {
      kind: status,
      label: `${label} · ${status}${short ? ` · ${short}` : ""}`,
    };
  } catch (err) {
    return { kind: "error", label: `${label} · error · ${errorMessage(err)}` };
  }
}

async function submitNote(
  material: NoteMaterial,
  label: string,
  { force, projectId, visibility }: SubmitContext,
): Promise<SubmitOutcome> {
  try {
    const res = await fetch("/api/app/ingest", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: [],
        notes: material.text,
        force,
        visibility,
        ...(projectId ? { projectId } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as IngestResponse;
    if (!res.ok) {
      return {
        kind: "error",
        label: `${label} · error · ${data.error ?? data.reason ?? String(res.status)}`,
      };
    }
    const short = data.id ? id8(data.id) : "";
    const status = pillFor(data);
    return {
      kind: status,
      label: `${label} · ${status}${short ? ` · ${short}` : ""}`,
    };
  } catch (err) {
    return { kind: "error", label: `${label} · error · ${errorMessage(err)}` };
  }
}

// Image batch: every image of one submit shares a batchId so the worker claims
// them together as a single SIGHT post. Mirrors the loop that lived in the old
// composer.tsx. The image endpoint doesn't accept `force`.
async function submitImageBatch(
  materials: ImageMaterial[],
  { projectId, visibility }: SubmitContext,
): Promise<SubmitOutcome[]> {
  const batchId = crypto.randomUUID();
  const total = materials.length;
  const notes = materials.find((m) => m.notes)?.notes ?? "";
  // Each image is an independent upload keyed by its own imageIndex; the worker
  // waits for all totalCount rows before claiming, so upload order doesn't
  // matter. Fire them concurrently; Promise.all preserves array order so the
  // pill log still reads image 1, 2, 3…
  return Promise.all(
    materials.map(async (m, i): Promise<SubmitOutcome> => {
      const label = `image ${i + 1}/${total}`;
      const fd = new FormData();
      fd.append("image", m.file, m.name);
      fd.append("batchId", batchId);
      fd.append("imageIndex", String(i));
      fd.append("totalCount", String(total));
      fd.append("notes", notes);
      fd.append("visibility", visibility);
      if (projectId) fd.append("projectId", projectId);
      try {
        const res = await fetch("/api/app/ingest-images", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as IngestResponse;
        if (!res.ok) {
          return {
            kind: "error",
            label: `${label} · ${data.error ?? data.reason ?? String(res.status)}`,
          };
        }
        const short = data.id ? id8(data.id) : id8(batchId);
        return {
          kind: pillFor(data),
          label: `${label} · ${short}`,
        };
      } catch (err) {
        return {
          kind: "error",
          label: `${label} · ${errorMessage(err)}`,
        };
      }
    }),
  );
}

// Generic single-file kinds (video/audio/document). Each material is one
// submission posted to the file-ingest endpoint; the worker forces the PostType
// per kind. The file endpoint doesn't accept `force`.
async function submitFile(
  material: VideoMaterial | AudioMaterial | DocumentMaterial,
  label: string,
  { projectId, visibility }: SubmitContext,
): Promise<SubmitOutcome> {
  const fd = new FormData();
  fd.append("file", material.file, material.name);
  fd.append("kind", material.kind);
  fd.append("notes", material.notes ?? "");
  fd.append("visibility", visibility);
  if (projectId) fd.append("projectId", projectId);
  try {
    const res = await fetch("/api/app/ingest-file", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const data = (await res.json().catch(() => ({}))) as IngestResponse;
    if (!res.ok) {
      return {
        kind: "error",
        label: `${label} · error · ${data.error ?? data.reason ?? String(res.status)}`,
      };
    }
    const short = data.id ? id8(data.id) : "";
    const status = pillFor(data);
    return {
      kind: status,
      label: `${label} · ${status}${short ? ` · ${short}` : ""}`,
    };
  } catch (err) {
    return { kind: "error", label: `${label} · error · ${errorMessage(err)}` };
  }
}

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
  };
}

// Dispatch the whole tray, returning one pill outcome per logical submission so
// the composer can render a status-pill log. URLs/notes/files each yield one
// outcome; the image batch yields one outcome per image (sharing a batchId).
export async function submitMaterials(
  materials: Material[],
  ctx: SubmitContext,
): Promise<SubmitOutcome[]> {
  const grouped = groupByKind(materials);

  // Every submission is independent (its own dedup hash; the tray already
  // deduped URLs), so fan each kind out concurrently. Promise.all preserves
  // array order, so the resulting pill log keeps its 1, 2, 3… numbering.
  const urlOutcomes = Promise.all(
    grouped.url.map((m, i) => {
      const label =
        grouped.url.length > 1 ? `url ${i + 1}/${grouped.url.length}` : "url";
      return submitUrl(m, label, ctx);
    }),
  );

  // A repo is a URL submission — the worker's github.com detection routes it to
  // the dedicated structure+key-files path. Reuse submitUrl with a repo label.
  const repoOutcomes = Promise.all(
    grouped.repo.map((m, i) => {
      const label = grouped.repo.length > 1 ? `repo ${i + 1}` : "repo";
      return submitUrl({ kind: "url", url: m.url, notes: m.notes }, label, ctx);
    }),
  );

  const noteOutcomes = Promise.all(
    grouped.note.map((m, i) => {
      const label = grouped.note.length > 1 ? `note ${i + 1}` : "note";
      return submitNote(m, label, ctx);
    }),
  );

  const imageOutcomes =
    grouped.image.length > 0
      ? submitImageBatch(grouped.image, ctx)
      : Promise.resolve([]);

  const videoOutcomes = Promise.all(
    grouped.video.map((m, i) => {
      const label = grouped.video.length > 1 ? `video ${i + 1}` : "video";
      return submitFile(m, label, ctx);
    }),
  );

  const audioOutcomes = Promise.all(
    grouped.audio.map((m, i) => {
      const label = grouped.audio.length > 1 ? `audio ${i + 1}` : "audio";
      return submitFile(m, label, ctx);
    }),
  );

  const documentOutcomes = Promise.all(
    grouped.document.map((m, i) => {
      const label =
        grouped.document.length > 1 ? `document ${i + 1}` : "document";
      return submitFile(m, label, ctx);
    }),
  );

  const [url, repo, note, image, video, audio, doc] = await Promise.all([
    urlOutcomes,
    repoOutcomes,
    noteOutcomes,
    imageOutcomes,
    videoOutcomes,
    audioOutcomes,
    documentOutcomes,
  ]);

  return [...url, ...repo, ...note, ...image, ...video, ...audio, ...doc];
}
