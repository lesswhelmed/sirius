"use client";

// The omni-ingest composer front door. Three vertical regions:
//   (1) OmniDropzone — one dashed area for drag-drop / paste / typed notes,
//   (2) StagingTray  — smart cards (type tag, inline edit, override, delete),
//   (3) UnifiedActionButton — one "Process {N} Items" submit.
// ALL classification/validation/override/dedup is the shared @repo/ingest-classify
// package's; this screen writes ZERO classification logic. At submit it maps each
// ClassifiedItem back onto the EXISTING Material model (omni-classify.toMaterials)
// and reuses the FROZEN submit path (submitMaterials → /api/app/ingest*).

import {
  type ClassifiedItem,
  type IngestKind,
  overrideKind,
  platformFor,
  validateItem,
} from "@repo/ingest-classify";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type { AudienceValue } from "../../../lib/groups/types";
import { DEFAULT_AUDIENCE } from "../../../lib/groups/types";
import { AudiencePicker } from "../_components/audience-picker";
import { type PillKind, submitMaterials } from "./materials";
import { toMaterials } from "./omni-classify";
import { type EmittedItems, OmniDropzone } from "./OmniDropzone";
import { StagingTray } from "./StagingTray";

interface ProjectOption {
  id: string;
  title: string;
  status: string;
}

interface StatusPill {
  id: string;
  kind: PillKind;
  label: string;
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
      />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Pill({ pill }: { pill: StatusPill }) {
  const tone =
    pill.kind === "queued" || pill.kind === "retrying"
      ? "border-[var(--color-sage)] text-[var(--color-sage)]"
      : pill.kind === "error"
        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
        : pill.kind === "invalid"
          ? "border-[var(--color-accent)] text-[var(--fg-muted)]"
          : "border-[var(--color-rule-strong)] text-[var(--fg-muted)]";

  const glyph =
    pill.kind === "queued"
      ? "●"
      : pill.kind === "retrying"
        ? "↻"
        : pill.kind === "error"
          ? "✕"
          : pill.kind === "invalid"
            ? "!"
            : "○";

  return (
    <div
      className={`flex items-center gap-3 border-y border-l-2 ${tone} bg-[var(--color-paper-raised)]/60 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]`}
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {glyph}
      </span>
      <span className="truncate">{pill.label}</span>
    </div>
  );
}

export function Composer() {
  // The tray of classified items (the single source of truth for the UI). The
  // real DOM Files live in a parallel registry keyed by item id; image thumbs
  // (object-URLs) likewise, so they can be revoked on remove/unmount.
  const [items, setItems] = useState<ClassifiedItem[]>([]);
  const fileRegistry = useRef<Map<string, File>>(new Map());
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());

  const [force, setForce] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [audience, setAudience] = useState<AudienceValue>(DEFAULT_AUDIENCE);
  const [pills, setPills] = useState<StatusPill[]>([]);
  const [isPending, startTransition] = useTransition();
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  // Load active projects once for the Focus picker.
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch("/api/app/projects?status=active", {
          credentials: "include",
        });
        if (res.ok) {
          const data = (await res.json()) as { items: ProjectOption[] };
          setProjects(data.items);
        }
      } catch {
        // gracefully ignore fetch errors
      }
    };
    fetchProjects();
  }, []);

  // Revoke every object-URL on unmount so previews don't leak.
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  useEffect(() => {
    const registry = fileRegistry.current;
    return () => {
      for (const url of thumbsRef.current.values()) URL.revokeObjectURL(url);
      registry.clear();
    };
  }, []);

  const addPill = useCallback((kind: PillKind, label: string) => {
    setPills((prev) =>
      [{ id: crypto.randomUUID(), kind, label }, ...prev].slice(0, 12),
    );
  }, []);

  // Append a batch of classified items emitted by the dropzone. Stashes their
  // real Files in the registry, makes image thumbnails, and surfaces any
  // dedup/cap counts from a multi-URL paste as pills.
  const onItems = useCallback(
    ({ items: incoming, files, deduped, capped }: EmittedItems) => {
      if (incoming.length === 0 && deduped === 0 && capped === 0) return;
      // Merge new Files into the registry; build object-URLs for images.
      const newThumbs = new Map<string, string>();
      for (const [id, file] of files) {
        fileRegistry.current.set(id, file);
      }
      for (const item of incoming) {
        if (item.kind === "image") {
          const file = files.get(item.id);
          if (file) newThumbs.set(item.id, URL.createObjectURL(file));
        }
      }
      if (incoming.length > 0) {
        setItems((prev) => [...prev, ...incoming]);
      }
      if (newThumbs.size > 0) {
        setThumbs((prev) => new Map([...prev, ...newThumbs]));
      }
      if (deduped > 0) {
        addPill(
          "deduped",
          `${deduped} duplicate link${deduped === 1 ? "" : "s"} skipped`,
        );
      }
      if (capped > 0) {
        addPill("invalid", `${capped} link${capped === 1 ? "" : "s"} over the cap`);
      }
    },
    [addPill],
  );

  // Inline content edit (url/note). Re-validate via the shared package.
  const onEdit = useCallback((id: string, value: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const patched: ClassifiedItem =
          item.kind === "url"
            ? { ...item, content: value, url: value, platform: platformFor(value) }
            : { ...item, content: value, text: value };
        const errors = validateItem(patched);
        return { ...patched, errors, error: errors[0] };
      }),
    );
  }, []);

  // Kind override (url⇄note, file⇄file). overrideKind re-derives + re-validates;
  // the package enforces legality (the menu only offers legal targets).
  const onOverride = useCallback((id: string, toKind: IngestKind) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? overrideKind(item, toKind) : item,
      ),
    );
  }, []);

  const onRemove = useCallback((id: string) => {
    fileRegistry.current.delete(id);
    setThumbs((prev) => {
      const url = prev.get(id);
      if (url) URL.revokeObjectURL(url);
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Submit-gating: disabled when tray empty OR any card has a CRITICAL error.
  // (In-tray duplicates are warn-only and never block — see StagingTray.)
  const hasCritical = useMemo(
    () => items.some((i) => i.errors.some((e) => e.severity === "critical")),
    [items],
  );
  const canSubmit = items.length > 0 && !hasCritical && !isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const materials = toMaterials(items, fileRegistry.current);
    const capturedThumbs = thumbs;
    startTransition(async () => {
      const outcomes = await submitMaterials(materials, {
        force,
        projectId,
        visibility: audience.visibility,
        groupIds: audience.groupIds,
      });
      for (const outcome of outcomes) {
        addPill(outcome.kind, outcome.label);
      }
      const failed = outcomes.some((o) => o.kind === "error");
      if (!failed) {
        for (const url of capturedThumbs.values()) URL.revokeObjectURL(url);
        fileRegistry.current.clear();
        setThumbs(new Map());
        setItems([]);
        setForce(false);
        setProjectId(null);
        setAudience(DEFAULT_AUDIENCE);
      }
    });
  };

  const actionLabel =
    items.length === 0
      ? "Add something to begin"
      : `Process ${items.length} Item${items.length === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {/* Per-item submit outcome pills (unchanged log pattern). */}
      {pills.length > 0 ? (
        <div className="flex flex-col gap-1.5" role="log" aria-live="polite">
          {pills.map((pill) => (
            <Pill key={pill.id} pill={pill} />
          ))}
        </div>
      ) : null}

      {/* Region 1: Omni-dropzone */}
      <OmniDropzone
        onItems={onItems}
        disabled={isPending}
        compact={items.length > 0}
      />

      {/* Region 2: Staging tray */}
      <StagingTray
        items={items}
        thumbs={thumbs}
        disabled={isPending}
        onEdit={onEdit}
        onOverride={onOverride}
        onRemove={onRemove}
      />

      {/* Focus chips (re-homed). Only render with ≥1 project. */}
      {projects.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            Focus
          </span>
          <div
            role="radiogroup"
            aria-label="Focus"
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {[{ id: null, title: "None" }, ...projects].map((p) => {
              const selected = projectId === p.id;
              return (
                <button
                  key={p.id ?? "__none__"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isPending}
                  onClick={() => setProjectId(p.id)}
                  className={`shrink-0 border px-3 py-1.5 font-body text-[14px] whitespace-nowrap transition-colors disabled:opacity-50 ${
                    selected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-paper)]"
                      : "border-[var(--color-rule-strong)] text-[var(--fg-muted)] hover:bg-[var(--color-paper-raised)]"
                  }`}
                >
                  {p.title}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Audience picker (shared with the post editor): base tiers + share-group
          multi-select + inline group creation. Applied to every staged item. */}
      <AudiencePicker
        mode="compose"
        value={audience}
        onChange={setAudience}
      />

      {/* No focus selected: auto-org will file this under a Project. */}
      {projectId === null ? (
        <p className="font-display italic text-[14px] text-[var(--fg-muted)]">
          No focus selected &mdash; we&rsquo;ll file this automatically once
          it&rsquo;s processed.
        </p>
      ) : null}

      {/* Force toggle (re-homed): bypass dedup / regenerate. */}
      <label className="flex w-fit cursor-pointer items-center gap-3 select-none">
        <span className="relative inline-flex items-center">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={isPending}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={`flex h-[18px] w-[18px] items-center justify-center border transition-colors ${
              force
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                : "border-[var(--color-rule-strong)] bg-transparent"
            } ${isPending ? "opacity-50" : ""}`}
          >
            {force ? (
              <svg
                width="11"
                height="9"
                viewBox="0 0 11 9"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 4.5L4 7.5L10 1"
                  stroke="var(--color-paper)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </span>
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          Force
        </span>
        <span className="font-display text-[14px] italic text-[var(--fg-subtle)]">
          bypass dedup · regenerate
        </span>
      </label>

      {/* Region 3: Unified action button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        aria-live="polite"
        className={`group relative h-12 w-full border bg-[var(--color-ink)] text-[var(--color-paper)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)] ${
          canSubmit
            ? "border-[var(--color-ink)] cursor-pointer hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] active:translate-y-px"
            : "border-[var(--color-rule-strong)] bg-[var(--color-paper-sunken)] text-[var(--fg-subtle)] cursor-not-allowed"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em]">
            <Spinner />
            Processing…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
              {actionLabel}
            </span>
            {items.length > 0 && canSubmit ? (
              <span
                aria-hidden="true"
                className="font-display italic text-[18px] leading-none"
              >
                →
              </span>
            ) : null}
          </span>
        )}
      </button>
    </div>
  );
}
