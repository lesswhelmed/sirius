// Mobile host glue for the omni-ingest Capture tab. Everything classification-
// related is delegated to the SHARED, pure @repo/ingest-classify package (the
// SAME core the web composer consumes) — this file holds ONLY the thin
// host-specific seam:
//
//   1. A FileDescriptor adapter that wraps an RN/Expo asset and KEEPS the real
//      `uri` keyed by the ClassifiedItem.id, so we can rebuild the existing
//      uri-based Material at submit time (the pure core never sees a uri).
//   2. consolidateErrors(): the §4 "collapse ≥3 same-code errors into one
//      tray-level summary" derivation. It is pure and could live in the package,
//      but is host-presentational, so it sits here next to the tray UI.
//   3. toMaterials(): maps ClassifiedItem[] (+ the uri registry) back onto the
//      EXISTING Material[] union so the FROZEN submitMaterials() path, endpoints,
//      worker, and DB are all untouched.
//
// ZERO classification logic is duplicated here — classifyText/classifyFile/
// validateItem/canOverride/overrideKind/dedupKey/platformFor all come from the
// shared package.
import {
  type ClassifiedItem,
  dedupKey,
  type FileDescriptor,
  type InlineError,
} from "@repo/ingest-classify";

import type { Material } from "@/lib/materials";

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

// ── 2. Error consolidation (§4) ──────────────────────────────────────────────

export interface ErrorSummary {
  code: InlineError["code"];
  count: number;
  message: string;
  severity: InlineError["severity"];
}

// The collapse threshold: ≥3 cards sharing one error code fold into a single
// tray-level summary line (and each card shows a subtle marker instead of the
// full sentence). Per-code; mixed codes never merge.
export const ERROR_COLLAPSE_THRESHOLD = 3;

// Plural summary copy per code. Mirrors the spec's §4 summary strings.
function summaryMessage(code: InlineError["code"], count: number): string {
  switch (code) {
    case "file_too_large":
      return `${count} files are over the size limit.`;
    case "file_unsupported":
      return `${count} files aren't a supported type.`;
    case "duplicate":
      return `${count} duplicate items — remove them or submit anyway.`;
    case "url_invalid":
      return `${count} links aren't valid web addresses.`;
    case "url_suspicious":
      return `${count} links may be hard to read.`;
    case "note_empty":
      return `${count} notes are empty.`;
  }
}

// Short per-card marker label shown when a card's code is collapsed.
export function markerLabel(code: InlineError["code"]): string {
  switch (code) {
    case "file_too_large":
      return "too large";
    case "file_unsupported":
      return "unsupported";
    case "duplicate":
      return "duplicate";
    case "url_invalid":
      return "invalid link";
    case "url_suspicious":
      return "check link";
    case "note_empty":
      return "empty";
  }
}

// Re-validate the tray for in-tray duplicates (§2.7) on top of each item's own
// errors, then return both the per-item effective errors and the set of codes
// that have collapsed. The first card with a given dedupKey is the keeper; the
// 2nd+ get a `duplicate` warn. Pure — derived state, never mutates the items.
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
  const seen = new Map<string, string>(); // dedupKey → first item id
  const byId = new Map<string, InlineError[]>();

  for (const item of items) {
    const errors: InlineError[] = [...(item.errors ?? [])];
    const key = dedupKey(item);
    const firstId = seen.get(key);
    if (firstId === undefined) {
      seen.set(key, item.id);
    } else {
      // 2nd+ occurrence: append the duplicate warn (never blocks submit).
      errors.push({
        field:
          item.kind === "url"
            ? "url"
            : item.kind === "note"
              ? "note"
              : "file",
        code: "duplicate",
        message:
          "Looks like a duplicate of another item — remove it or submit both.",
        severity: "warn",
      });
    }
    byId.set(item.id, errors);
  }

  // Count codes across the tray for the collapse decision.
  const counts = new Map<InlineError["code"], number>();
  for (const errors of byId.values()) {
    for (const e of errors) {
      counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
    }
  }

  const collapsedCodes = new Set<InlineError["code"]>();
  const summaries: ErrorSummary[] = [];
  for (const [code, count] of counts) {
    if (count >= ERROR_COLLAPSE_THRESHOLD) {
      collapsedCodes.add(code);
      // The summary's severity follows whether ANY instance is critical.
      const severity: InlineError["severity"] = Array.from(byId.values()).some(
        (errs) => errs.some((e) => e.code === code && e.severity === "critical"),
      )
        ? "critical"
        : "warn";
      summaries.push({ code, count, message: summaryMessage(code, count), severity });
    }
  }

  const hasCritical = Array.from(byId.values()).some((errs) =>
    errs.some((e) => e.severity === "critical"),
  );

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
    case "note":
      return { kind: "note", text: item.text ?? item.content };
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
): { id: string; material: Material }[] {
  const pairs: { id: string; material: Material }[] = [];
  for (const item of items) {
    const note = notesById.get(item.id)?.trim() || undefined;
    const material = toMaterial(item, registry, note);
    if (material) pairs.push({ id: item.id, material });
  }
  return pairs;
}

// Map the whole tray. `notesById` carries the per-card note (id → text).
export function toMaterials(
  items: ClassifiedItem[],
  registry: FileRegistry,
  notesById: Map<string, string>,
): Material[] {
  return toMaterialPairs(items, registry, notesById).map((p) => p.material);
}
