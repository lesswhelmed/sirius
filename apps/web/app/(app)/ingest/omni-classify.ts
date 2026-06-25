"use client";

// Web host adapter for @repo/ingest-classify. This file writes ZERO
// classification logic — every classify/validate/override/dedup decision is
// imported from the shared pure package. What lives here is purely the thin
// HOST layer the package's design contract (§5, "Material mapping at submit")
// expects each host to provide:
//   1. wrapping a DOM `File` into a host-neutral `FileDescriptor`,
//   2. keeping the real `File` keyed by the classified item's id, and
//   3. mapping a `ClassifiedItem` back onto the EXISTING `Material` union so the
//      FROZEN submit pipeline (submitMaterials → /api/app/ingest*) is untouched.

import type { ClassifiedItem, FileDescriptor } from "@repo/ingest-classify";

import type { Material } from "./materials";

// ── DOM File → host-neutral FileDescriptor ───────────────────────────────────
// The pure core only reads name/mimeType/size; `ref` carries the real DOM File
// through opaquely so the host can retrieve the bytes at submit time.
export function describeFile(file: File): FileDescriptor {
  return {
    name: file.name,
    mimeType: file.type,
    size: file.size,
    ref: file,
  };
}

// Pull the real DOM File back out of a classified file item. The descriptor's
// opaque `ref` is the DOM File we stashed in describeFile(); we fall back to a
// host-side registry keyed by item id for safety (e.g. after an override that
// preserves the descriptor).
export function fileFor(
  item: ClassifiedItem,
  registry: Map<string, File>,
): File | null {
  const fromRegistry = registry.get(item.id);
  if (fromRegistry) return fromRegistry;
  const ref = item.file?.ref;
  return ref instanceof File ? ref : null;
}

// ── ClassifiedItem → existing Material ───────────────────────────────────────
// Produces exactly the shape submitMaterials() already consumes, so submit.ts,
// the endpoints, the worker, and the DB stay frozen. A url whose platform is
// "repository" maps to the existing RepoMaterial so the worker's github.com
// path still fires (RepoMaterial submits identically to a url — see
// materials.ts submitMaterials). Returns null for a card with no usable bytes
// (skipped at submit; the caller should never pass a critical-error card).
export function toMaterial(
  item: ClassifiedItem,
  registry: Map<string, File>,
): Material | null {
  switch (item.kind) {
    case "url": {
      const url = item.url ?? item.content;
      if (item.platform === "repository") {
        return { kind: "repo", url };
      }
      return { kind: "url", url };
    }
    case "note": {
      const text = (item.text ?? item.content).trim();
      return { kind: "note", text };
    }
    case "image":
    case "video":
    case "audio":
    case "document": {
      const file = fileFor(item, registry);
      if (!file) return null;
      return {
        kind: item.kind,
        file,
        name: item.file?.name ?? file.name,
        type: item.file?.mimeType ?? file.type,
      };
    }
  }
}

// Map a whole tray of classified items to Material[] for submitMaterials.
// Skips any item that yields no material (defensive — submit-gating already
// blocks the tray on a critical error).
export function toMaterials(
  items: ClassifiedItem[],
  registry: Map<string, File>,
): Material[] {
  const out: Material[] = [];
  for (const item of items) {
    const material = toMaterial(item, registry);
    if (material) out.push(material);
  }
  return out;
}
