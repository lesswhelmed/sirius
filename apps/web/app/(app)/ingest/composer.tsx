"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";

import {
  CAPTURE_KINDS,
  type CaptureKind,
  type CaptureKindKey,
  classifyUrl,
  describeMaterial,
  type ImageMaterial,
  type Material,
  MAX_URLS_PER_BATCH,
  type PillKind,
  submitMaterials,
  trayTag,
  urlMaterialsFromText,
} from "./materials";

// A material staged in the tray, with a stable id for keys + removal. Image
// kinds also carry an object-URL preview that must be revoked on removal.
interface StagedMaterial {
  uid: string;
  material: Material;
  preview?: string;
}

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

// Sheet copy for the two form kinds (link, note). Mirrors mobile FORM_COPY.
const FORM_COPY: Record<
  Extract<CaptureKindKey, "link" | "note">,
  { title: string; label: string; placeholder: string }
> = {
  link: {
    title: "Add link",
    label: "URLs (one per line)",
    placeholder: "https://example.com/post\nhttps://instagram.com/p/…",
  },
  note: {
    title: "Add note",
    label: "Note",
    placeholder: "Anything to remember…",
  },
};

// Split the registry into rows of two so the cards lay out as a tidy 2-up grid
// regardless of how many kinds it grows to. Mirrors mobile pairs().
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(items.slice(i, i + 2));
  }
  return out;
}

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
    pill.kind === "queued"
      ? "border-[var(--color-sage)] text-[var(--color-sage)]"
      : pill.kind === "error"
        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
        : pill.kind === "invalid"
          ? "border-[var(--color-accent)] text-[var(--fg-muted)]"
          : "border-[var(--color-rule-strong)] text-[var(--fg-muted)]";

  const glyph =
    pill.kind === "queued"
      ? "●"
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

// An action card — one capture kind in the "What are you adding?" grid. Styled
// with surface-raised + a large glyph + mono label, the web analog of mobile's
// ActionCard.
function ActionCard({
  kind,
  active,
  disabled,
  onClick,
}: {
  kind: CaptureKind;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={kind.hint}
      className={`surface-raised flex h-24 flex-1 flex-col items-start justify-between p-3.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)] ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "hover:bg-[var(--color-paper-sunken)]"
      } ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
    >
      <span aria-hidden="true" className="text-[26px] leading-none text-[var(--fg-muted)]">
        {kind.glyph}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
        {kind.label}
      </span>
    </button>
  );
}

// An in-page modal "sheet": a fixed overlay with editorial styling. Mirrors
// mobile's Sheet.
function Sheet({
  open,
  title,
  onClose,
  closeDisabled,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, closeDisabled]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--color-ink)]/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <div
        className="surface-raised w-full max-w-lg p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between border-b border-[var(--color-rule)] pb-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-40"
          >
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Composer() {
  const [tray, setTray] = useState<StagedMaterial[]>([]);
  const [activeKey, setActiveKey] = useState<Extract<
    CaptureKindKey,
    "link" | "note"
  > | null>(null);
  const [draft, setDraft] = useState("");
  const [force, setForce] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pills, setPills] = useState<StatusPill[]>([]);
  const [isPending, startTransition] = useTransition();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  // Audio capture sheet: record a voice memo or pick an audio file.
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  // MediaRecorder state lives in refs so React renders stay cheap. The stream
  // is held separately from the recorder so unmount cleanup can stop the mic
  // tracks even if it fires before the recorder is assigned.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Load active projects once for the Focus picker; if none/forbidden, the
  // picker simply never renders.
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

  // Revoke every staged object-URL on unmount so previews don't leak.
  useEffect(() => {
    return () => {
      for (const entry of tray) {
        if (entry.preview) URL.revokeObjectURL(entry.preview);
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // Intentionally run only on unmount: removeFromTray revokes per-item, so a
    // tray-dep cleanup here would double-revoke live previews.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive the URL preview list from the url-kind materials currently in the
  // tray, reusing the IG/other classification (a kept web extra).
  const urlPreview = useMemo(
    () =>
      tray
        .filter((e) => e.material.kind === "url")
        .map((e) => classifyUrl((e.material as { url: string }).url)),
    [tray]
  );
  const igCount = urlPreview.filter((p) => p.kind === "instagram").length;
  const otherUrlCount = urlPreview.filter((p) => p.kind === "other").length;

  const addPill = useCallback((kind: PillKind, label: string) => {
    setPills((prev) =>
      [{ id: crypto.randomUUID(), kind, label }, ...prev].slice(0, 12)
    );
  }, []);

  const addToTray = useCallback((materials: Material[]) => {
    if (materials.length === 0) return;
    setTray((prev) => [
      ...prev,
      ...materials.map((material) => ({
        uid: crypto.randomUUID(),
        material,
        preview:
          material.kind === "image"
            ? URL.createObjectURL(material.file)
            : undefined,
      })),
    ]);
  }, []);

  const removeFromTray = useCallback((uid: string) => {
    setTray((prev) => {
      const target = prev.find((e) => e.uid === uid);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((e) => e.uid !== uid);
    });
  }, []);

  // Build file-backed materials from a picked FileList, filtering by the kind's
  // expected family where it matters (images).
  const addImageFiles = useCallback(
    (incoming: FileList) => {
      const materials: ImageMaterial[] = [];
      for (const file of Array.from(incoming)) {
        if (!file.type.startsWith("image/")) continue;
        materials.push({
          kind: "image",
          file,
          name: file.name,
          type: file.type,
        });
      }
      addToTray(materials);
    },
    [addToTray]
  );

  function onCardPress(kind: CaptureKind) {
    if (isPending) return;
    switch (kind.key) {
      case "photos":
        imageInputRef.current?.click();
        return;
      case "video":
        videoInputRef.current?.click();
        return;
      case "document":
        documentInputRef.current?.click();
        return;
      case "audio":
        setAudioSheetOpen(true);
        return;
      case "link":
      case "note":
        setDraft("");
        setActiveKey(kind.key);
        return;
    }
  }

  // Confirm the link/note sheet → parse and stage. Surfaced dup/overflow counts
  // become status pills.
  function confirmForm() {
    if (activeKey === "link") {
      const { materials, deduped, capped } = urlMaterialsFromText(draft);
      if (materials.length === 0) {
        addPill("invalid", "no links · paste at least one URL");
        return;
      }
      addToTray(materials);
      if (deduped > 0) {
        addPill(
          "deduped",
          `${deduped} duplicate URL${deduped === 1 ? "" : "s"} skipped`
        );
      }
      if (capped > 0) {
        addPill(
          "invalid",
          `${capped} URL${capped === 1 ? "" : "s"} over the ${MAX_URLS_PER_BATCH} cap`
        );
      }
    } else if (activeKey === "note") {
      const text = draft.trim();
      if (text.length === 0) {
        addPill("invalid", "empty note · write something first");
        return;
      }
      addToTray([{ kind: "note", text }]);
    }
    setActiveKey(null);
    setDraft("");
  }

  // ── Audio: in-browser recording via MediaRecorder ──────────────────────────
  async function startRecording() {
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(recordedChunksRef.current, {
          type: "audio/webm",
        });
        const name = `voice-memo-${Date.now()}.webm`;
        const file = new File([blob], name, { type: "audio/webm" });
        addToTray([{ kind: "audio", file, name, type: "audio/webm" }]);
        recorderRef.current = null;
        setIsRecording(false);
        setAudioSheetOpen(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      // Stop the mic tracks if getUserMedia succeeded but MediaRecorder
      // construction (or codec selection) threw, so the device isn't held open.
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      addPill("error", "audio · microphone unavailable");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  function onPickAudioFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    addToTray([
      {
        kind: "audio",
        file,
        name: file.name,
        type: file.type || "audio/mpeg",
      },
    ]);
    setAudioSheetOpen(false);
  }

  const handleSubmit = () => {
    if (tray.length === 0 || isPending) return;
    const materials = tray.map((e) => e.material);
    const captured = tray;
    startTransition(async () => {
      const outcomes = await submitMaterials(materials, { force, projectId });
      for (const outcome of outcomes) {
        addPill(outcome.kind, outcome.label);
      }
      const failed = outcomes.some((o) => o.kind === "error");
      if (!failed) {
        for (const entry of captured) {
          if (entry.preview) URL.revokeObjectURL(entry.preview);
        }
        setTray([]);
        setForce(false);
        setProjectId(null);
      }
    });
  };

  const canSubmit = tray.length > 0 && !isPending;
  const formCopy = activeKey ? FORM_COPY[activeKey] : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {pills.length > 0 ? (
        <div className="flex flex-col gap-1.5" role="log" aria-live="polite">
          {pills.map((pill) => (
            <Pill key={pill.id} pill={pill} />
          ))}
        </div>
      ) : null}

      {/* Capture-card grid: "What are you adding?" */}
      <div className="flex flex-col gap-3">
        <p className="font-display italic text-[20px] text-[var(--fg)]">
          What are you adding?
        </p>
        <div className="flex flex-col gap-3">
          {pairs(CAPTURE_KINDS).map((row, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex gap-3">
              {row.map((kind) => (
                <ActionCard
                  key={kind.key}
                  kind={kind}
                  active={activeKey === kind.key}
                  disabled={isPending}
                  onClick={() => onCardPress(kind)}
                />
              ))}
              {row.length === 1 ? <div className="flex-1" /> : null}
            </div>
          ))}
        </div>
      </div>

      {/* Focus chips (replaces the old <select>). Only render with ≥1 project. */}
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

      {/* URL preview list with IG/other badges (kept web extra). */}
      {urlPreview.length > 0 ? (
        <details open className="surface-raised">
          <summary className="cursor-pointer border-b border-[var(--color-rule)] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Preview ({urlPreview.length} URL
            {urlPreview.length === 1 ? "" : "s"} · {igCount} IG · {otherUrlCount}{" "}
            other)
          </summary>
          <ol className="max-h-64 overflow-y-auto">
            {urlPreview.map((entry, idx) => (
              <li
                key={`${entry.raw}-${idx}`}
                className="flex items-baseline gap-3 border-b border-[var(--color-rule)] px-3.5 py-1.5 font-mono text-[11px] last:border-b-0"
              >
                <span className="w-8 shrink-0 tabular-nums text-[var(--fg-subtle)]">
                  {(idx + 1).toString().padStart(3, "0")}
                </span>
                <span
                  className={`shrink-0 font-bold uppercase tracking-[0.16em] ${
                    entry.kind === "instagram"
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--fg-muted)]"
                  }`}
                >
                  {entry.kind === "instagram" ? "IG" : "URL"}
                </span>
                <span className="truncate text-[var(--fg-muted)]">
                  {entry.raw}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {/* Staging tray (mirror mobile TrayRow). */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-[var(--color-rule)] pb-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
            In tray
          </span>
          <span
            aria-live="polite"
            aria-label={
              tray.length === 0
                ? "Tray empty"
                : `${tray.length} item${tray.length === 1 ? "" : "s"} in tray`
            }
            className="font-mono text-[11px] tabular-nums text-[var(--fg-subtle)]"
          >
            {tray.length}
          </span>
        </div>
        {tray.length === 0 ? (
          <p className="font-display italic text-[15px] text-[var(--fg-muted)]">
            Nothing staged yet. Pick something above to begin.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tray.map((entry) => (
              <li
                key={entry.uid}
                className="surface-raised flex items-center gap-3 p-2.5"
              >
                {entry.material.kind === "image" && entry.preview ? (
                  <span className="h-11 w-11 shrink-0 overflow-hidden border border-[var(--color-rule-strong)] bg-[var(--color-paper-sunken)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={entry.preview}
                      alt={describeMaterial(entry.material)}
                      className="h-full w-full object-cover"
                    />
                  </span>
                ) : null}
                <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--fg-subtle)]">
                  {trayTag(entry.material)}
                </span>
                <span className="min-w-0 flex-1 truncate font-body text-[14px] text-[var(--fg-muted)]">
                  {describeMaterial(entry.material)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromTray(entry.uid)}
                  disabled={isPending}
                  aria-label={`Remove ${trayTag(entry.material).toLowerCase()}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--fg-subtle)] hover:text-[var(--color-accent)] disabled:opacity-40"
                >
                  <IconX />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Force toggle (kept web extra). */}
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

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        className={`group relative h-12 w-full border bg-[var(--color-ink)] text-[var(--color-paper)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:ring-offset-2 focus:ring-offset-[var(--bg)] ${
          canSubmit
            ? "border-[var(--color-ink)] cursor-pointer hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)] active:translate-y-px"
            : "border-[var(--color-rule-strong)] bg-[var(--color-paper-sunken)] text-[var(--fg-subtle)] cursor-not-allowed"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-3 font-mono text-[11px] uppercase tracking-[0.3em]">
            <Spinner />
            Ingesting
          </span>
        ) : (
          <span className="flex items-center justify-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
              {tray.length === 0 ? "Add something to submit" : "Send to press"}
            </span>
            {tray.length > 0 ? (
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

      {/* Hidden file inputs triggered by the capture cards. */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Image file input"
        onChange={(e) => {
          if (e.target.files) addImageFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Video file input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            addToTray([
              {
                kind: "video",
                file,
                name: file.name,
                type: file.type || "video/mp4",
              },
            ]);
          }
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept="application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        tabIndex={-1}
        aria-label="Document file input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            addToTray([
              {
                kind: "document",
                file,
                name: file.name,
                type: file.type || "application/pdf",
              },
            ]);
          }
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Audio file input"
        onChange={onPickAudioFile}
      />

      {/* Link / Note sheet. */}
      <Sheet
        open={activeKey !== null}
        title={formCopy?.title ?? ""}
        onClose={() => setActiveKey(null)}
      >
        {formCopy ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
                {formCopy.label}
              </span>
              <textarea
                rows={6}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                placeholder={formCopy.placeholder}
                className="block w-full resize-y border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2 font-body text-[16px] leading-[1.6] text-[var(--fg)] outline-none placeholder:italic placeholder:text-[var(--fg-subtle)]"
              />
            </label>
            <button
              type="button"
              onClick={confirmForm}
              className="h-11 w-full border border-[var(--color-ink)] bg-[var(--color-ink)] font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-paper)] hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)]"
            >
              Add to tray
            </button>
          </div>
        ) : null}
      </Sheet>

      {/* Audio sheet: record or pick. */}
      <Sheet
        open={audioSheetOpen}
        title="Audio"
        closeDisabled={isRecording}
        onClose={() => setAudioSheetOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`h-11 w-full border font-mono text-[10px] uppercase tracking-[0.3em] ${
              isRecording
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-paper)]"
                : "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-accent)] hover:border-[var(--color-accent)]"
            }`}
          >
            {isRecording ? "Stop recording" : "Record voice memo"}
          </button>
          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            disabled={isRecording}
            className="h-11 w-full border border-[var(--color-rule-strong)] font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--fg-muted)] hover:bg-[var(--color-paper-raised)] disabled:opacity-40"
          >
            Pick audio file
          </button>
        </div>
      </Sheet>
    </div>
  );
}
