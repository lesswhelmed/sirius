import { getUserHandle } from "@repo/db";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireSession } from "../../lib/session";
import { SetupHandleForm } from "./form";

export default function SetupHandlePage() {
  return (
    <section className="mx-auto max-w-xl">
      <header className="mb-8 sm:mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Before you publish anything
        </p>
        <h1 className="mt-2 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[48px]">
          Pick your handle
          <span className="text-[var(--color-accent)]">.</span>
        </h1>
        <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)] text-pretty">
          Your catalog lives at{" "}
          <code className="font-mono not-italic">/catalog/&lt;handle&gt;</code>.
          Lowercase letters, digits, and hyphens; 3–30 characters.
        </p>
      </header>
      <Suspense fallback={null}>
        <SetupHandleGate />
      </Suspense>
    </section>
  );
}

async function SetupHandleGate() {
  const session = await requireSession("/setup-handle");
  const existing = await getUserHandle(session.user.id);
  if (existing) {
    redirect("/ingest");
  }

  const suggested =
    session.user.email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 30) ?? "";

  return <SetupHandleForm suggested={suggested} />;
}
