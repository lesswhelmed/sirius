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
      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
    >
      {pending ? "…" : "Sign out"}
    </button>
  );
}
