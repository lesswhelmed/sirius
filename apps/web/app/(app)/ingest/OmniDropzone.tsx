"use client";

// The single top region. ONE dashed-border area that accepts (a) native
// drag-and-drop of multiple files, (b) paste of URLs/text, (c) typed notes via a
// focused textarea, plus a visible "browse files" affordance for a keyboard /
// non-drag path. ALL inputs route through the shared package's
// classifyText/classifyFile/classifyInput — this component writes ZERO
// classification logic. It emits the classified items (and the real DOM Files,
// so the host can key them by item id) upward.

import {
  type ClassifiedItem,
  classifyFile,
  classifyText,
} from "@repo/ingest-classify";
import { type DragEvent, useCallback, useRef, useState } from "react";

import { describeFile } from "./omni-classify";

export interface EmittedItems {
  items: ClassifiedItem[];
  // Real DOM Files keyed by the classified item id, for the host registry.
  files: Map<string, File>;
  // Surfaced dedup/cap counts from a multi-URL paste (parity with old pills).
  deduped: number;
  capped: number;
}

const IDLE_COPY = "Drop any link, file, or note here. We'll handle the sorting.";

export function OmniDropzone({
  onItems,
  disabled,
  compact,
}: {
  onItems: (emitted: EmittedItems) => void;
  disabled?: boolean;
  // Collapses to a one-line "drop more" affordance once the tray is non-empty.
  compact?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Classify a FileList → items + a registry of real Files keyed by item id.
  const emitFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      const items: ClassifiedItem[] = [];
      const registry = new Map<string, File>();
      for (const file of files) {
        const item = classifyFile(describeFile(file));
        items.push(item);
        registry.set(item.id, file);
      }
      onItems({ items, files: registry, deduped: 0, capped: 0 });
    },
    [onItems],
  );

  // Classify a text blob → url cards + at most one note card.
  const emitText = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      const { items, deduped, capped } = classifyText(raw);
      if (items.length === 0 && deduped === 0 && capped === 0) return;
      onItems({ items, files: new Map(), deduped, capped });
    },
    [onItems],
  );

  function commitDraft() {
    if (draft.trim().length === 0) return;
    emitText(draft);
    setDraft("");
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dt = e.dataTransfer;
      // §2.1: files are authoritative. If files present, IGNORE the text
      // fallback (it is almost always the file's own URI and would double-add).
      if (dt.files && dt.files.length > 0) {
        emitFiles(dt.files);
        return;
      }
      const text = dt.getData("text");
      if (text) emitText(text);
    },
    [disabled, emitFiles, emitText],
  );

  return (
    <div
      role="group"
      aria-label="Omni input. Drop files, paste links, or type a note."
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex flex-col gap-3 border border-dashed p-4 transition-colors ${
        dragOver
          ? "border-[var(--color-rule-emphatic)] bg-[var(--color-paper-raised)]"
          : "border-[var(--color-rule-strong)]"
      } ${disabled ? "opacity-50" : ""}`}
    >
      {!compact ? (
        <div className="flex flex-col items-center gap-1 pt-1 text-center">
          <span
            aria-hidden="true"
            className="font-display text-[22px] italic text-[var(--fg-subtle)]"
          >
            ⌖
          </span>
          <p className="font-display text-[17px] italic leading-snug text-[var(--fg-muted)]">
            {IDLE_COPY}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="sr-only">Type or paste a link, file, or note</span>
          <textarea
            ref={textRef}
            rows={compact ? 1 : 2}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter commits; Shift+Enter inserts a newline (for multi-line
              // notes / multi-URL blobs).
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitDraft();
              }
            }}
            placeholder={
              compact ? "Drop more, or type a note…" : "type or paste…"
            }
            className="block w-full resize-y border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2 font-body text-[15px] leading-[1.6] text-[var(--fg)] outline-none placeholder:italic placeholder:text-[var(--fg-subtle)] disabled:opacity-50"
          />
        </label>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={commitDraft}
            disabled={disabled || draft.trim().length === 0}
            className="h-[38px] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-paper)] transition-colors hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:border-[var(--color-rule-strong)] disabled:bg-[var(--color-paper-sunken)] disabled:text-[var(--fg-subtle)]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="h-[38px] border border-[var(--color-rule-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:bg-[var(--color-paper-raised)] disabled:opacity-40"
          >
            Browse files
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        tabIndex={-1}
        aria-label="Browse files to add"
        onChange={(e) => {
          if (e.target.files) emitFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
