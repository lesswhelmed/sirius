"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";

// Mirrors the detail view's prose styling so the live preview is faithful to
// how the published post renders.
const MARKDOWN_CLASS_NAME = [
  "drop-cap break-words font-body text-[18px] leading-[1.7] text-[var(--fg)]",
  "[&_p]:my-5 [&_p:first-child]:mt-0",
  "[&_a]:text-[var(--color-accent)] [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-[var(--color-accent-deep)]",
  "[&_h1]:mt-10 [&_h1]:font-display [&_h1]:text-[38px] [&_h1]:leading-none [&_h1]:tracking-[-0.01em]",
  "[&_h2]:mt-9 [&_h2]:font-display [&_h2]:text-[30px] [&_h2]:leading-tight",
  "[&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-[24px] [&_h3]:leading-tight",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-1.5 [&_blockquote]:my-7 [&_blockquote]:border-l [&_blockquote]:border-[var(--color-accent)] [&_blockquote]:pl-5 [&_blockquote]:italic [&_blockquote]:text-[var(--fg-muted)]",
  "[&_code]:font-mono [&_code]:text-[0.86em] [&_code]:text-[var(--color-accent-deep)]",
  "[&_pre]:my-7 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--color-rule)] [&_pre]:bg-[var(--color-paper-raised)] [&_pre]:p-4",
  "[&_img]:my-8 [&_img]:block [&_img]:w-full [&_img]:rounded-sm [&_img]:border [&_img]:border-[var(--color-rule)]",
].join(" ");

const FIELD_CLASS =
  "w-full bg-[var(--color-paper-raised)] border border-[var(--color-rule)] px-3 py-2 font-body text-[var(--fg)] outline-none focus:border-[var(--color-accent)]";
const LABEL_CLASS =
  "block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] mb-1.5";

type Props = {
  slug: string;
  initialTitle: string;
  initialExcerpt: string;
  initialContent: string;
  initialStatus: "PUBLISHED" | "DRAFT" | "ARCHIVED";
  updatedAt: string;
};

export function PostEditor({
  slug,
  initialTitle,
  initialExcerpt,
  initialContent,
  initialStatus,
  updatedAt,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraft = initialStatus === "DRAFT";
  const isDirty =
    title !== initialTitle ||
    excerpt !== initialExcerpt ||
    content !== initialContent;

  // Warn on hard navigation / tab close while there are unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Modern browsers show their generic "unsaved changes" prompt when the
      // default is prevented; no message string is honored anymore.
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const save = useCallback(
    async (publish: boolean) => {
      setSaving(true);
      setError(null);
      try {
        const body: Record<string, unknown> = {
          title: title.trim(),
          excerpt: excerpt.trim() === "" ? null : excerpt.trim(),
          content,
          expectedUpdatedAt: updatedAt,
        };
        if (publish) body.status = "PUBLISHED";
        const res = await fetch(`/api/app/posts/${slug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `Save failed (${res.status})`);
        }
        // The PATCH already revalidated the cache tags; navigate back and
        // refresh so the detail view shows the fresh body.
        router.push(`/posts/${slug}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
        setSaving(false);
      }
    },
    [title, excerpt, content, updatedAt, slug, router],
  );

  const cancel = useCallback(() => {
    if (isDirty && !window.confirm("Discard your unsaved changes?")) return;
    router.push(`/posts/${slug}`);
  }, [isDirty, router, slug]);

  const previewContent = useMemo(() => content || "*Nothing to preview yet.*", [
    content,
  ]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-rule-emphatic)] pb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)]">
          Editing · {initialStatus}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="border border-[var(--color-rule)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving || (!isDirty && !isDraft)}
            className="border border-[var(--color-rule)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {isDraft ? (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-paper)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Publishing…" : "Save & Publish"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mt-3 border border-[var(--color-danger,#b00)] bg-[var(--color-paper-raised)] px-3 py-2 font-mono text-[12px] text-[var(--color-danger,#b00)]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        {/* Editor pane */}
        <div className="flex flex-col gap-5">
          <div>
            <label className={LABEL_CLASS} htmlFor="post-title">
              Title
            </label>
            <input
              id="post-title"
              className={FIELD_CLASS}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="post-excerpt">
              Excerpt
            </label>
            <input
              id="post-excerpt"
              className={FIELD_CLASS}
              value={excerpt}
              placeholder="Optional one-line summary"
              onChange={(e) => setExcerpt(e.target.value)}
            />
          </div>
          <div className="flex flex-1 flex-col">
            <label className={LABEL_CLASS} htmlFor="post-body">
              Body (Markdown)
            </label>
            <textarea
              id="post-body"
              className={`${FIELD_CLASS} min-h-[60vh] flex-1 resize-y font-mono text-[14px] leading-[1.6]`}
              value={content}
              placeholder="Write your post in Markdown…"
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>

        {/* Live preview pane */}
        <div className="lg:border-l lg:border-[var(--color-rule)] lg:pl-10">
          <span className={LABEL_CLASS}>Preview</span>
          {title.trim() ? (
            <h1 className="mt-2 mb-6 font-display text-[40px] leading-[0.98] tracking-[-0.015em]">
              {title}
            </h1>
          ) : null}
          <Streamdown className={MARKDOWN_CLASS_NAME} mode="static">
            {previewContent}
          </Streamdown>
        </div>
      </div>
    </div>
  );
}
