"use client";

// One staged tray item. Thin host rendering over a ClassifiedItem — every
// classification/validation/override decision is the shared package's; this
// component only renders and routes user intent (edit text, override kind,
// remove) back up. Manages inline-edit focus: entering edit focuses the field,
// committing returns focus to the card (spec §6 / Step 6).

import {
  type ClassifiedItem,
  type IngestKind,
  type PlatformLabel,
} from "@repo/ingest-classify";
import { useEffect, useRef, useState } from "react";

import { InlineCardError } from "./InlineCardError";
import { KindOverrideMenu } from "./KindOverrideMenu";

const PLATFORM_LABEL: Record<PlatformLabel, string> = {
  repository: "Repository",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  link: "Link",
};

function IconX({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 2L10 10M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const TEXT_EDITABLE: ReadonlySet<IngestKind> = new Set(["url", "note"]);

export function SmartCard({
  item,
  thumbUrl,
  collapsedCodes,
  groupBadge,
  disabled,
  onEdit,
  onOverride,
  onRemove,
}: {
  item: ClassifiedItem;
  thumbUrl?: string;
  collapsedCodes: ReadonlySet<string>;
  // e.g. "1 of 3 · SIGHT" shown on grouped photo cards (O-4).
  groupBadge?: string;
  disabled?: boolean;
  onEdit: (id: string, value: string) => void;
  onOverride: (id: string, toKind: IngestKind) => void;
  onRemove: (id: string) => void;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);

  const editable = TEXT_EDITABLE.has(item.kind) && !disabled;
  const hasError = item.errors.length > 0;
  const critical = item.errors.some((e) => e.severity === "critical");

  // Keep the draft in sync when the item content changes externally (e.g. an
  // override rebuilds the item) and we're not mid-edit.
  useEffect(() => {
    if (!editing) setDraft(item.content);
  }, [item.content, editing]);

  // Focus the textarea when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== item.content) onEdit(item.id, next);
    // Return focus to the card, never let it fall to <body> (spec §6).
    requestAnimationFrame(() => cardRef.current?.focus());
  }

  function cancel() {
    setDraft(item.content);
    setEditing(false);
    requestAnimationFrame(() => cardRef.current?.focus());
  }

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className={`surface-raised flex flex-col p-2.5 outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] ${
        critical ? "border-[var(--color-accent)]" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Image thumbnail */}
        {item.kind === "image" && thumbUrl ? (
          <span className="h-11 w-11 shrink-0 overflow-hidden border border-[var(--color-rule-strong)] bg-[var(--color-paper-sunken)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl}
              alt={item.content}
              className="h-full w-full object-cover"
            />
          </span>
        ) : null}

        {/* Kind tag */}
        <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-subtle)]">
          {item.displayTag}
        </span>

        {/* Platform pill (url only) */}
        {item.kind === "url" && item.platform ? (
          <span className="shrink-0 border border-[var(--color-rule-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--fg-muted)]">
            {PLATFORM_LABEL[item.platform]}
          </span>
        ) : null}

        {/* Content: editable for url/note, static for files */}
        {editing ? (
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            aria-label={`Edit ${item.displayTag.toLowerCase()} content`}
            className="min-w-0 flex-1 resize-none border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-1 font-body text-[14px] leading-snug text-[var(--fg)] outline-none focus:border-[var(--color-rule-strong)]"
          />
        ) : (
          <button
            type="button"
            disabled={!editable}
            onClick={() => editable && setEditing(true)}
            aria-label={
              editable
                ? `Edit ${item.displayTag.toLowerCase()}: ${item.content}`
                : item.content
            }
            className={`min-w-0 flex-1 truncate text-left font-body text-[14px] text-[var(--fg-muted)] ${
              editable
                ? "cursor-text rounded-none hover:text-[var(--fg)]"
                : "cursor-default"
            }`}
          >
            {item.content || (
              <span className="italic text-[var(--fg-subtle)]">empty</span>
            )}
          </button>
        )}

        {/* Group badge (photo SIGHT batch) */}
        {groupBadge ? (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-sage)]">
            {groupBadge}
          </span>
        ) : null}

        {/* Kind override */}
        <KindOverrideMenu
          fromKind={item.kind}
          disabled={disabled}
          onSelect={(toKind) => onOverride(item.id, toKind)}
        />

        {/* Delete */}
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={disabled}
          aria-label={`Remove ${item.displayTag.toLowerCase()}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--fg-subtle)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          <IconX />
        </button>
      </div>

      {hasError ? (
        <InlineCardError
          errors={item.errors}
          collapsedCodes={collapsedCodes}
          onEditRequest={editable ? () => setEditing(true) : undefined}
        />
      ) : null}
    </li>
  );
}
