"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// One-time blocking Terms-of-Use acceptance panel (App Store Guideline 1.2
// Part A). Rendered by the (app) layout INSTEAD of children whenever the
// session user has no termsAcceptedAt — i.e. accounts created before the
// sign-up agreement checkbox existed (new registrations are stamped at
// creation). Accepting POSTs /api/app/account/accept-terms, then
// router.refresh() re-runs the server gate with the fresh session and the app
// renders normally.
export function TermsGate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/account/accept-terms", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`accept failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "accept failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Before you continue
      </p>
      <h1 className="mt-2 font-display italic text-[40px] leading-[0.98] tracking-[-0.01em] sm:text-[48px]">
        Terms of Use<span className="text-[var(--color-accent)]">.</span>
      </h1>
      <div className="mt-6 space-y-4 font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
        <p>
          Sirius has <strong>zero tolerance</strong> for objectionable content
          or abusive behavior. Content or accounts that violate our terms are
          removed and offending users ejected. Reports are reviewed and acted
          on within 24 hours.
        </p>
        <p>
          Please read the{" "}
          <Link
            href="/terms"
            target="_blank"
            className="text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
          >
            Terms of Use
          </Link>{" "}
          — continuing requires your agreement.
        </p>
      </div>
      <div className="mt-8 flex items-baseline gap-4">
        <button
          type="button"
          onClick={accept}
          disabled={busy}
          className="border border-[var(--color-ink)] bg-[var(--color-ink)] px-7 py-3 font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-paper-raised)] transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "Saving…" : "I agree"}
        </button>
        {error ? (
          <span className="font-mono text-[10px] text-[var(--color-accent)]">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
