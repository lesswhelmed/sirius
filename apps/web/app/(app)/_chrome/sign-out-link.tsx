"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "../../../lib/auth-client";

export function SignOutLink() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await signOut();
          router.replace("/sign-in");
          router.refresh();
        })
      }
      className="rounded-[6px] px-2 py-1 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:opacity-50"
    >
      {pending ? "…" : "Sign out"}
    </button>
  );
}
