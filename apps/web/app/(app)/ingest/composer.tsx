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
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 15V4M12 4L8 8M12 4L16 8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
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
        : "border-[var(--color-rule-strong)] text-[var(--fg-muted)]";

  const glyph =
    pill.kind === "queued" ? "●" : pill.kind === "error" ? "✕" : "○";

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
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden border border-[var(--color-rule-strong)] bg-[var(--color-paper-sunken)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.preview}
        alt={item.file.name}
        className="h-full w-full object-cover"
      />
      {!disabled ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-ink)]/60 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.file.name}`}
            className="flex h-6 w-6 items-center justify-center bg-[var(--color-accent)] text-[var(--color-paper)] hover:opacity-90"
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
    setPills((prev) =>
      [{ id: crypto.randomUUID(), kind, label }, ...prev].slice(0, 12)
    );
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
              const data = (await res
                .json()
                .catch(() => ({}))) as IngestResponse;
              if (!res.ok) {
                addPill(
                  "error",
                  `error · ${data.error ?? data.reason ?? String(res.status)}`
                );
                return;
              }
              const short = data.id ? id8(data.id) : id8(batchId);
              addPill(
                data.deduped ? "deduped" : "queued",
                `${data.deduped ? "deduped" : "queued"} · ${short}`
              );
            })
            .catch((err: unknown) => {
              addPill(
                "error",
                `error · ${err instanceof Error ? err.message : "network"}`
              );
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
                const data = (await res
                  .json()
                  .catch(() => ({}))) as IngestResponse;
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {pills.length > 0 ? (
        <div className="flex flex-col gap-1.5" role="log" aria-live="polite">
          {pills.map((pill) => (
            <Pill key={pill.id} pill={pill} />
          ))}
        </div>
      ) : null}

      <div className="paper-card">
        <div className="flex items-center justify-between border-b border-[var(--color-rule)] bg-[var(--color-paper-sunken)]/50 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          <span>Manuscript</span>
          <span className="nums-lining tabular-nums">
            {charCount.toString().padStart(4, "0")} characters
          </span>
        </div>
        <textarea
          rows={6}
          value={text}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setText(e.target.value)
          }
          placeholder="Paste URLs (one per line) or free-form notes…"
          disabled={isPending}
          aria-label="Content input"
          className="block w-full resize-y bg-transparent px-4 py-3 font-body text-[17px] leading-[1.6] text-[var(--fg)] outline-none placeholder:italic placeholder:text-[var(--fg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="border-t border-[var(--color-rule)] px-4 py-2 text-[12px] italic text-[var(--fg-subtle)]">
          Lines beginning with{" "}
          <code className="font-mono not-italic text-[var(--fg-muted)]">
            http
          </code>{" "}
          are filed as URLs; everything else becomes a note.
        </p>
      </div>

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
          bypass dedup
        </span>
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
            className={`flex h-28 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed transition-colors ${
              isDragging
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)]/40 hover:bg-[var(--color-paper-raised)]"
            } ${isPending ? "pointer-events-none opacity-50" : ""}`}
          >
            <span className="text-[var(--fg-muted)]">
              <IconUpload />
            </span>
            <p className="font-display text-[15px] italic text-[var(--fg-muted)]">
              Drop plates here, or{" "}
              <span className="text-[var(--color-accent)] underline underline-offset-4">
                browse
              </span>
            </p>
          </div>
        ) : (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`border border-dashed p-3 transition-colors ${
              isDragging
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                : "border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)]/40"
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
                className="flex h-16 w-16 items-center justify-center border border-dashed border-[var(--color-rule-strong)] text-[var(--fg-subtle)] transition-colors hover:bg-[var(--color-paper-raised)] hover:text-[var(--fg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M8 2v12M2 8h12"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <p className="mt-3 px-1 font-mono text-[10px] uppercase tracking-[0.2em] tabular-nums text-[var(--fg-subtle)]">
              {files.length.toString().padStart(2, "0")} plate
              {files.length !== 1 ? "s" : ""} attached
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
              Send to press
            </span>
            <span
              aria-hidden="true"
              className="font-display italic text-[18px] leading-none"
            >
              →
            </span>
          </span>
        )}
      </button>
    </div>
  );
}
