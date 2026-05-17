"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type DragEvent,
} from "react";

type PillKind = "queued" | "deduped" | "error";

interface StatusPill {
  id: string;
  kind: PillKind;
  label: string;
}

interface IngestResponse {
  id?: string;
  status?: string;
  reason?: string;
  error?: string;
  deduped?: boolean;
}

function id8(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

function parseTextarea(raw: string): { urls: string[]; notes: string } {
  const lines = raw.split(/\r?\n/);
  const urls: string[] = [];
  const noteLines: string[] = [];
  for (const line of lines) {
    if (/^https?:\/\//i.test(line.trim())) {
      urls.push(line.trim());
    } else {
      noteLines.push(line);
    }
  }
  return { urls, notes: noteLines.join("\n").trim() };
}

function IconUpload() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 13V4M10 4L6.5 7.5M10 4L13.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 14v1.5A1.5 1.5 0 0 0 4.5 17h11A1.5 1.5 0 0 0 17 15.5V14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconX({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
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
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
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
      ? "border-[color:var(--color-status-completed)]/30 bg-[color:var(--color-status-completed)]/12 text-[var(--status-completed)]"
      : pill.kind === "error"
        ? "border-[color:var(--color-status-failed)]/30 bg-[color:var(--color-status-failed)]/12 text-[var(--status-failed)]"
        : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--fg-muted)]";

  const dot =
    pill.kind === "queued"
      ? "bg-[var(--status-completed)]"
      : pill.kind === "error"
        ? "bg-[var(--status-failed)]"
        : "bg-[var(--fg-subtle)]";

  return (
    <div
      className={`flex items-center gap-2 rounded-[6px] border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] ${tone}`}
    >
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {pill.label}
    </div>
  );
}

interface AttachedFile {
  id: string;
  file: File;
  preview: string;
}

function Thumbnail({
  item,
  onRemove,
  disabled,
}: {
  item: AttachedFile;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.preview} alt={item.file.name} className="h-full w-full object-cover" />
      {!disabled ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.file.name}`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--status-failed)] text-white hover:opacity-90"
          >
            <IconX size={10} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Composer() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [force, setForce] = useState(false);
  const [pills, setPills] = useState<StatusPill[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      for (const f of files) URL.revokeObjectURL(f.preview);
    };
  }, [files]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      const next: AttachedFile[] = [];
      for (const file of Array.from(incoming)) {
        if (!file.type.startsWith("image/")) continue;
        const id = `${file.name}-${file.size}-${file.lastModified}`;
        if (existing.has(id)) continue;
        next.push({ id, file, preview: URL.createObjectURL(file) });
      }
      return next.length ? [...prev, ...next] : prev;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const addPill = (kind: PillKind, label: string) => {
    setPills((prev) => [{ id: crypto.randomUUID(), kind, label }, ...prev].slice(0, 12));
  };

  const handleSubmit = () => {
    const hasText = text.trim().length > 0;
    const hasImages = files.length > 0;
    if (!hasText && !hasImages) return;

    const batchId = crypto.randomUUID();
    const { urls, notes } = parseTextarea(text);
    const captured = [...files];

    startTransition(async () => {
      const requests: Promise<void>[] = [];

      if (hasText) {
        requests.push(
          fetch("/api/app/ingest", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls, notes, force }),
          })
            .then(async (res) => {
              const data = (await res.json().catch(() => ({}))) as IngestResponse;
              if (!res.ok) {
                addPill("error", `error · ${data.error ?? data.reason ?? String(res.status)}`);
                return;
              }
              const short = data.id ? id8(data.id) : id8(batchId);
              addPill(data.deduped ? "deduped" : "queued", `${data.deduped ? "deduped" : "queued"} · ${short}`);
            })
            .catch((err: unknown) => {
              addPill("error", `error · ${err instanceof Error ? err.message : "network"}`);
            })
        );
      }

      if (hasImages) {
        for (let i = 0; i < captured.length; i++) {
          const item = captured[i];
          if (!item) continue;
          const fd = new FormData();
          fd.append("image", item.file);
          fd.append("batchId", batchId);
          fd.append("imageIndex", String(i));
          fd.append("totalCount", String(captured.length));
          fd.append("notes", notes);
          requests.push(
            fetch("/api/app/ingest-images", {
              method: "POST",
              credentials: "include",
              body: fd,
            })
              .then(async (res) => {
                const data = (await res.json().catch(() => ({}))) as IngestResponse;
                if (!res.ok) {
                  addPill(
                    "error",
                    `image ${i + 1}/${captured.length} · ${data.error ?? data.reason ?? String(res.status)}`
                  );
                  return;
                }
                const short = data.id ? id8(data.id) : id8(batchId);
                addPill(
                  data.deduped ? "deduped" : "queued",
                  `image ${i + 1}/${captured.length} · ${short}`
                );
              })
              .catch((err: unknown) => {
                addPill(
                  "error",
                  `image ${i + 1}/${captured.length} · ${err instanceof Error ? err.message : "network"}`
                );
              })
          );
        }
      }

      await Promise.all(requests);

      for (const f of captured) URL.revokeObjectURL(f.preview);
      setFiles([]);
      setText("");
      setForce(false);
    });
  };

  const canSubmit = (text.trim().length > 0 || files.length > 0) && !isPending;
  const charCount = text.length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {pills.length > 0 ? (
        <div className="flex flex-col gap-1.5" role="log" aria-live="polite">
          {pills.map((pill) => (
            <Pill key={pill.id} pill={pill} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <textarea
          rows={5}
          value={text}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          placeholder="Paste URLs (one per line) or free-form notes…"
          disabled={isPending}
          aria-label="Content input"
          className="w-full resize-y rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[14.5px] leading-relaxed text-[var(--fg)] outline-none transition-colors placeholder:text-[var(--fg-subtle)] focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[color:var(--color-accent-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-0.5">
          <p className="text-[11px] text-[var(--fg-subtle)]">
            Lines starting with{" "}
            <code className="font-mono text-[var(--fg-muted)]">http</code> are parsed as URLs;
            everything else becomes notes.
          </p>
          <span className="font-mono text-[11px] tabular-nums text-[var(--fg-subtle)]">
            {charCount}
          </span>
        </div>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 select-none">
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
            className={`flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors ${
              force
                ? "border-[var(--accent)] bg-[var(--accent)]"
                : "border-[var(--border-strong)] bg-[var(--surface)]"
            } ${isPending ? "opacity-50" : ""}`}
          >
            {force ? (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true">
                <path
                  d="M1 3.5L3.5 6L8 1"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </span>
        </span>
        <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--fg-muted)]">
          force
        </span>
        <span className="text-[12px] text-[var(--fg-subtle)]">bypass dedup</span>
      </label>

      <div>
        {files.length === 0 ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop images here or click to upload"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={`flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed transition-colors ${
              isDragging
                ? "border-[var(--accent)] bg-[color:var(--color-accent-soft)]"
                : "border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"
            } ${isPending ? "pointer-events-none opacity-50" : ""}`}
          >
            <span className="text-[var(--fg-subtle)]">
              <IconUpload />
            </span>
            <p className="text-[12px] text-[var(--fg-subtle)]">
              Drop images here or{" "}
              <span className="text-[var(--fg-muted)] underline underline-offset-2">
                click to browse
              </span>
            </p>
          </div>
        ) : (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`rounded-[8px] border border-dashed p-2 transition-colors ${
              isDragging
                ? "border-[var(--accent)] bg-[color:var(--color-accent-soft)]"
                : "border-[var(--border-strong)] bg-[var(--surface)]"
            }`}
          >
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {files.map((f) => (
                <Thumbnail
                  key={f.id}
                  item={f}
                  onRemove={() => removeFile(f.id)}
                  disabled={isPending}
                />
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPending}
                aria-label="Add more images"
                className="flex h-16 w-16 items-center justify-center rounded-[6px] border border-dashed border-[var(--border-strong)] text-[var(--fg-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 2v12M2 8h12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <p className="mt-2 px-1 font-mono text-[11px] tabular-nums text-[var(--fg-subtle)]">
              {files.length} image{files.length !== 1 ? "s" : ""} selected
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (e.target.files) {
              addFiles(e.target.files);
              e.target.value = "";
            }
          }}
          aria-label="Image file input"
          tabIndex={-1}
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        className={`h-10 w-full rounded-[8px] bg-[var(--accent)] text-[14px] font-medium text-white transition-opacity focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)] focus:ring-offset-1 focus:ring-offset-[var(--bg)] ${
          canSubmit ? "cursor-pointer hover:opacity-90 active:opacity-80" : "cursor-not-allowed opacity-40"
        }`}
      >
        {isPending ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner />
            Ingesting…
          </span>
        ) : (
          "Ingest"
        )}
      </button>
    </div>
  );
}
