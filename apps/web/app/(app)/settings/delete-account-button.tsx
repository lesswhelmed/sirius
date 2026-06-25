"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { authClient } from "../../../lib/auth-client";

// In-app account deletion (App Store Guideline 5.1.1(v)). Reveals an inline
// confirmation that requires the user to type DELETE and re-enter their
// password; better-auth verifies the password server-side, then deletes the
// User row (every user-owned table cascades) and the beforeDelete hook purges
// retained files. Deletion is immediate and permanent — on success we send the
// now-signed-out user back to sign-in.
//
// Autofill note: a text field immediately before a <input type="password"> is
// read by browsers as a login form, so password managers offered to fill the
// "type DELETE" box as a username. We deliberately do NOT mark this as a login
// form — no `autocomplete="current-password"`, non-credential field names, and
// password-manager ignore hints (data-1p-ignore / data-lpignore / data-form-type)
// — so neither field is treated as a username/password pair. Re-entering the
// password by hand is the intended UX for a destructive action anyway.
export function DeleteAccountButton() {
  const router = useRouter();
  const confirmId = useId();
  const passwordId = useId();
  const warningId = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit =
    confirmWord.trim().toUpperCase() === "DELETE" &&
    password.length > 0 &&
    state !== "busy";

  function reset() {
    setOpen(false);
    setPassword("");
    setConfirmWord("");
    setState("idle");
    setErrorMessage(null);
  }

  async function onConfirm() {
    if (!canSubmit) return;
    setState("busy");
    setErrorMessage(null);
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      setState("error");
      setErrorMessage(
        error.message ?? "That password didn’t match. Try again.",
      );
      return;
    }
    // Deleted + signed out server-side. Leave the cockpit for good.
    router.replace("/sign-in");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void onConfirm();
      }}
      className="max-w-[460px] space-y-4 border border-[var(--color-accent)] p-5"
    >
      <p
        id={warningId}
        className="font-body text-[14px] leading-[1.7] text-[var(--fg-muted)]"
      >
        This permanently deletes your account and all of your captures, posts,
        and uploaded files. This cannot be undone. Type{" "}
        <span className="font-mono text-[var(--fg)]">DELETE</span> and enter your
        password to confirm.
      </p>
      <div className="space-y-2">
        <label
          htmlFor={confirmId}
          className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
        >
          Type DELETE to confirm
        </label>
        <input
          id={confirmId}
          name="sirius-delete-confirm"
          type="text"
          value={confirmWord}
          onChange={(e) => setConfirmWord(e.target.value)}
          aria-describedby={warningId}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block w-full border border-[var(--color-rule-strong)] bg-transparent px-3 py-2 font-mono text-[13px] tracking-[0.1em] text-[var(--fg)] outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div className="space-y-2">
        <label
          htmlFor={passwordId}
          className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]"
        >
          Your password
        </label>
        <input
          id={passwordId}
          name="sirius-delete-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={warningId}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="block w-full border border-[var(--color-rule-strong)] bg-transparent px-3 py-2 font-body text-[14px] text-[var(--fg)] outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      {errorMessage ? (
        <p
          role="alert"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]"
        >
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="border border-[var(--color-accent)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--color-accent)]"
        >
          {state === "busy" ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={state === "busy"}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
