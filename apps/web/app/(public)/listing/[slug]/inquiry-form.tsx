"use client";

import { useState, useTransition } from "react";

interface InquiryFormProps {
  postId: string;
  postTitle: string;
  sellerName: string;
  prefillEmail: string;
  prefillName: string;
}

export function InquiryForm({
  postId,
  postTitle,
  sellerName,
  prefillEmail,
  prefillName,
}: InquiryFormProps) {
  const [name, setName] = useState(prefillName);
  const [email, setEmail] = useState(prefillEmail);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    const trimmedMsg = message.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email so they can reply.");
      return;
    }
    if (trimmedMsg.length < 5) {
      setError("Add a short note — what would you like to know?");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/app/inquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          fromName: name.trim() || null,
          fromEmail: trimmedEmail,
          message: trimmedMsg,
        }),
      });
      if (res.status === 429) {
        setError("Slow down — too many inquiries from your IP. Try again later.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setSent(true);
      setMessage("");
    });
  };

  if (sent) {
    return (
      <div className="border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent-deep)]">
          Note delivered
        </p>
        <p className="mt-2 font-display italic text-[18px] leading-snug text-[var(--fg)]">
          {sellerName} has been notified. They&rsquo;ll write back to {email}.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)]/40 p-5"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Request more info
      </p>
      <h3 className="mt-1 font-display italic text-[22px] leading-tight text-[var(--fg)]">
        Write {sellerName}
        <span className="text-[var(--color-accent)]">.</span>
      </h3>
      <p className="mt-2 font-display italic text-[14px] text-[var(--fg-muted)]">
        Re: <span className="not-italic">&ldquo;{postTitle}&rdquo;</span>
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Your name (optional)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            className="border-b border-[var(--color-rule)] bg-transparent py-1.5 font-body text-[15px] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Your email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isPending}
            className="border-b border-[var(--color-rule)] bg-transparent py-1.5 font-body text-[15px] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
            Message
          </span>
          <textarea
            required
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={isPending}
            placeholder="Is this still available? Any provenance docs?"
            className="resize-y border border-[var(--color-rule)] bg-transparent px-2 py-2 font-body text-[15px] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-accent)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-5 h-11 w-full border border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:bg-[var(--color-accent)] enabled:hover:border-[var(--color-accent)]"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.32em]">
          {isPending ? "Sending…" : "Send the note →"}
        </span>
      </button>
    </form>
  );
}
