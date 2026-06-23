"use client";

import Image from "next/image";
import { useState, useEffect } from "react";

export function InviteDialog({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/u/${handle}`
      : `/u/${handle}`;
  const cardSrc = `/u/${handle}/card`;
  const qrSrc = `/u/${handle}/qr`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Add me on Sirius",
          text: "Add me on Sirius",
          url: link,
        });
        return;
      } catch {
        // user canceled or unsupported — fall through to copy
      }
    }
    void copy();
  }

  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        Share invite link
      </button>
      <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
        /u/{handle}
      </span>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[640px] border border-[var(--color-rule-emphatic)] bg-[var(--bg)] p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Invite a friend"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between hairline-b pb-3">
              <h2 className="font-display italic text-[24px] text-[var(--fg)]">
                Invite a friend
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="font-mono text-[14px] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid gap-6 sm:grid-cols-[1fr_180px]">
              <Image
                unoptimized
                src={cardSrc}
                alt="Your invite card"
                width={460}
                height={240}
                className="w-full self-start rounded-lg border border-[var(--color-rule)]"
              />
              <div className="flex flex-col items-center gap-2">
                <Image
                  unoptimized
                  src={qrSrc}
                  alt="QR code to add me"
                  width={160}
                  height={160}
                  className="h-[160px] w-[160px] rounded-md bg-white p-2"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                  Scan to add me
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <input
                readOnly
                value={link}
                className="min-w-[180px] flex-1 border border-[var(--color-rule)] bg-transparent px-3 py-2 font-mono text-[12px] text-[var(--fg-muted)]"
              />
              <button
                type="button"
                onClick={copy}
                className="border border-[var(--color-rule-emphatic)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
              <button
                type="button"
                onClick={share}
                className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-paper)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
