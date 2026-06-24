"use client";

import { useState, useTransition } from "react";

// The author/byline shape the API returns alongside each comment.
type CommentAuthor = {
  id: string;
  name: string;
  handle: string | null;
  image: string | null;
};

export type CommentItem = {
  id: string;
  body: string;
  authorKind: "USER" | "AGENT";
  authorId: string | null;
  agentName: string | null;
  createdAt: string;
  author: CommentAuthor | null;
};

function authorLabel(c: CommentItem): string {
  if (c.authorKind === "AGENT") return c.agentName ?? "Agent";
  if (c.author?.handle) return `@${c.author.handle}`;
  return c.author?.name ?? "Unknown";
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function CommentsSection({
  slug,
  currentUserId,
  initialComments,
}: {
  slug: string;
  currentUserId: string;
  initialComments: CommentItem[];
}) {
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const res = await fetch(`/api/app/posts/${slug}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      // Append the created comment from the 201 response rather than refetching
      // the first page — so a post with >50 comments doesn't lose the rows the
      // user had already scrolled past.
      const data = (await res.json().catch(() => null)) as {
        comment?: CommentItem;
      } | null;
      if (data?.comment) {
        setComments((prev) => [...prev, data.comment as CommentItem]);
      }
      setBody("");
    });
  };

  const onDelete = (id: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/app/posts/${slug}/comments/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== id));
      }
    });
  };

  return (
    <section className="mx-auto mt-12 max-w-[680px]">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Conversation
        {comments.length > 0 ? (
          <span className="ml-2 text-[var(--fg-faint)]">{comments.length}</span>
        ) : null}
      </h2>

      <ul className="mt-6 space-y-6">
        {comments.length === 0 ? (
          <li className="font-display italic text-[16px] text-[var(--fg-muted)]">
            No comments yet — start the conversation.
          </li>
        ) : (
          comments.map((c) => (
            <li
              key={c.id}
              className="border-b border-[var(--color-rule)] pb-5 last:border-b-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
                  {authorLabel(c)}
                </span>
                <span className="flex items-baseline gap-3 font-mono text-[10px] text-[var(--fg-subtle)]">
                  <span>{dateFmt.format(new Date(c.createdAt))}</span>
                  {c.authorId === currentUserId ? (
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      disabled={isPending}
                      className="uppercase tracking-[0.16em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
                    >
                      Delete
                    </button>
                  ) : null}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words font-body text-[16px] leading-[1.6] text-[var(--fg)]">
                {c.body}
              </p>
            </li>
          ))
        )}
      </ul>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isPending}
          rows={3}
          maxLength={5000}
          aria-label="Add a comment"
          placeholder="Add a comment…"
          className="w-full resize-y border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] p-3 font-body text-[16px] leading-[1.6] outline-none placeholder:text-[var(--fg-subtle)] focus:border-[var(--color-accent)]"
        />
        {error ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {error}
          </span>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending || body.trim().length === 0}
            className="h-11 border border-[var(--color-ink)] bg-[var(--color-ink)] px-6 text-[var(--color-paper)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:border-[var(--color-accent)] enabled:hover:bg-[var(--color-accent)]"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
              {isPending ? "Posting…" : "Post comment →"}
            </span>
          </button>
        </div>
      </form>
    </section>
  );
}
