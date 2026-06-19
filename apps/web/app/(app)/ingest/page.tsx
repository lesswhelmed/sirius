import { Composer } from "./composer";

export default function IngestPage() {
  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-8 sm:mb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Section I — Dispatch Desk
        </p>
        <h1 className="mt-2 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] text-balance sm:text-[48px]">
          What did you find
          <span className="text-[var(--color-accent)]">?</span>
        </h1>
        <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)] text-pretty">
          Drop a link, write a note, attach an image. The worker will turn it
          into something fit to print.
        </p>
      </header>
      <Composer />
    </section>
  );
}
