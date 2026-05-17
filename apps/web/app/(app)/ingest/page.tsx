import { Composer } from "./composer";

export default function IngestPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
          Capture
        </p>
        <h1 className="mt-1 text-[28px] font-medium leading-tight text-[var(--fg)]">
          What did you find?
        </h1>
        <p className="mt-2 text-[14px] text-[var(--fg-muted)]">
          Drop a link, write a note, or attach images. The worker turns it
          into a post.
        </p>
      </header>
      <Composer />
    </section>
  );
}
