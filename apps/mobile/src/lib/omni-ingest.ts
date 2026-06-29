// Mobile host glue for the omni-ingest Capture tab. Everything classification-
// related is delegated to the SHARED, pure @repo/ingest-classify package (the
// SAME core the web composer consumes) — this file holds ONLY the thin
// host-specific seam:
//
//   1. A FileDescriptor adapter that wraps an RN/Expo asset and KEEPS the real
//      `uri` keyed by the ClassifiedItem.id, so we can rebuild the existing
//      uri-based Material at submit time (the pure core never sees a uri).
//   2. toMaterials(): maps ClassifiedItem[] (+ the uri registry) back onto the
//      EXISTING Material[] union so the FROZEN submitMaterials() path, endpoints,
//      worker, and DB are all untouched.
//
// ZERO classification OR consolidation logic is duplicated here — classifyText/
// classifyFile/validateItem/canOverride/overrideKind/dedupKey/platformFor AND
// the §4 error-collapse + §2.7 in-tray-dedup presentation (consolidateErrors,
// markerLabel, the canonical summary copy) all come from the shared package, so
// web and mobile show IDENTICAL copy.
import {
  type ClassifiedItem,
  consolidateErrors,
  type ErrorSummary,
  type FileDescriptor,
  type InlineError,
  markerLabel,
} from "@repo/ingest-classify";

import type { Material } from "@/lib/materials";

// Re-export the shared consolidation surface under the names the mobile tray
// components import from this module (no logic — just a thin host re-export).
export type { ErrorSummary };
export { markerLabel };

// ── 1. RN asset → FileDescriptor adapter ─────────────────────────────────────

// The minimal shape we need off any RN/Expo asset (ImagePicker asset, document
// picker asset, recorded-audio descriptor). The real bytes live behind `uri`.
export interface RnAsset {
  uri: string;
  name: string;
  // expo-image-picker exposes `mimeType`; some pickers use `type`. Either or
  // neither — the classifier's extension fallback covers a blank mime.
  mimeType?: string | null;
  type?: string | null;
  size?: number | null;
}

// Wrap an RN/Expo asset into the host-neutral FileDescriptor the pure core
// reads. We stash the asset itself as the opaque `ref` so the classifier carries
// it through untouched; the registry below maps item.id → the asset for submit.
export function descriptorFromAsset(asset: RnAsset): FileDescriptor {
  return {
    name: asset.name,
    // asset.mimeType ?? asset.type ?? "" — exactly the adapter contract; a blank
    // mime is fine, the package falls back to the file extension.
    mimeType: asset.mimeType ?? asset.type ?? "",
    size: asset.size ?? 0,
    ref: asset,
  };
}

// Per-tray registry of the real assets, keyed by ClassifiedItem.id. The pure
// classifier only ever sees metadata; the host owns the bytes. We read it back
// in toMaterials() when rebuilding the uri-based Material.
export type FileRegistry = Map<string, RnAsset>;

// ── 2. Error consolidation (§4 + §2.7) — delegated to the shared package ──────

// The §4 error-collapse + §2.7 in-tray-dedup PRESENTATION lives ONCE in
// @repo/ingest-classify (consolidateErrors) so this tab and the web composer
// show identical copy, incl. the {LIMIT} value. This is the only host glue: it
// re-shapes the package's TrayConsolidation into the exact fields the mobile
// tray reads (byId / collapsedCodes / summaries / hasCritical) — no collapse or
// dedup logic is re-implemented here.
export function deriveTrayErrors(items: ClassifiedItem[]): {
  // item.id → the effective errors for that card (its own + any duplicate warn).
  byId: Map<string, InlineError[]>;
  // Codes that crossed the collapse threshold across the whole tray.
  collapsedCodes: Set<InlineError["code"]>;
  // The tray-level summary lines (one per collapsed code).
  summaries: ErrorSummary[];
  // True iff ANY card carries a critical error → submit is blocked.
  hasCritical: boolean;
} {
  const { byId, collapsedCodes, summaries, hasCritical } =
    consolidateErrors(items);
  return { byId, collapsedCodes, summaries, hasCritical };
}

// ── 3. ClassifiedItem[] → Material[] adapter ─────────────────────────────────

// Map one classified card to the existing Material, pulling the real uri from
// the registry for file kinds. `notes` is the optional per-card note the user
// attached via the inline edit sheet (kept out of the pure core, which has no
// notion of notes). A `repository`-platform url maps to the existing `repo`
// Material so the worker's dedicated GitHub path + the tray's REPO tag stay
// consistent — both still submit via submitUrl (boundary #1 in the spec).
export function toMaterial(
  item: ClassifiedItem,
  registry: FileRegistry,
  notes: string | undefined,
): Material | null {
  switch (item.kind) {
    case "url": {
      const url = item.url ?? item.content;
      if (item.platform === "repository") {
        return { kind: "repo", url, notes };
      }
      return { kind: "url", url, notes };
    }
    case "note": {
      // NoteMaterial carries no `notes` field — a resolved (global) note is
      // merged into the text using the same format as applyNote, so it reaches
      // the BLOG draft. A note-kind card's inline edit changes its text (it has
      // no notesById entry), so `notes` here is only ever the submission note.
      const base = item.text ?? item.content;
      return {
        kind: "note",
        text: notes ? `${base}\n\nAuthor's notes: ${notes}` : base,
      };
    }
    case "image":
    case "video":
    case "audio":
    case "document": {
      const asset = registry.get(item.id);
      if (!asset) return null; // no bytes → can't submit; skip defensively
      return {
        kind: item.kind,
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? asset.type ?? item.file?.mimeType ?? "",
        notes,
      };
    }
  }
}

// Map the whole tray to (itemId, Material) pairs. Keeping the item id alongside
// each Material lets the caller map a submit failure (matched by Material
// reference) back to the exact tray card to keep staged for retry — robust even
// when some items are skipped (a file card whose bytes went missing).
export function toMaterialPairs(
  items: ClassifiedItem[],
  registry: FileRegistry,
  notesById: Map<string, string>,
  submissionNote?: string,
): { id: string; material: Material }[] {
  const pairs: { id: string; material: Material }[] = [];
  // The whole-submission note applies to every item; a per-item tray note
  // (notesById) overrides it for that item. Empty → undefined (note omitted).
  const global = submissionNote?.trim() || undefined;
  for (const item of items) {
    const note = notesById.get(item.id)?.trim() || global;
    const material = toMaterial(item, registry, note);
    if (material) pairs.push({ id: item.id, material });
  }
  return pairs;
}

// Map the whole tray. `notesById` carries the per-card note (id → text);
// `submissionNote` is the optional whole-submission note (per-item overrides it).
export function toMaterials(
  items: ClassifiedItem[],
  registry: FileRegistry,
  notesById: Map<string, string>,
  submissionNote?: string,
): Material[] {
  return toMaterialPairs(items, registry, notesById, submissionNote).map(
    (p) => p.material,
  );
}
