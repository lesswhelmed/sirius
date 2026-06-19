import { Eyebrow } from "./primitives";

const FEATURES = [
  {
    title: "Capture anything",
    body: "Links, photos, notes, code repositories, videos, documents, and voice memos — one inbox for everything worth remembering.",
  },
  {
    title: "AI drafting",
    body: "Raw input becomes a structured post — not a dead bookmark. You always review before it's kept. On iPhone it can draft on-device.",
  },
  {
    title: "Your catalog",
    body: "Your whole library in one place, from first draft to published entry, searchable and yours.",
  },
  {
    title: "A live queue",
    body: "Watch each capture move from pending to processing to done. Nothing gets lost on the way in.",
  },
  {
    title: "The Tree",
    body: "Explore everything by theme, category, and the focus areas it belongs to — related entries group themselves so the collection stays legible as it grows.",
  },
  {
    title: "Your data, your terms",
    body: "Originals stay private and you can export everything you've put in. No third-party ads, no cross-app tracking.",
  },
] as const;

export function Features() {
  return (
    <section className="border-t border-[var(--color-rule)] py-16 lg:py-24">
      <div className="hairline-b flex items-end justify-between gap-4 pb-4">
        <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-none tracking-[-0.01em] text-[var(--color-ink)]">
          What&apos;s inside
        </h2>
        <Eyebrow>Six things it does well</Eyebrow>
      </div>

      {/* Hairline grid: a rule-colored track shows through a 1px gap between
          opaque cells, so separators are clean at any column count without
          per-cell nth-child border math. */}
      <div className="mt-8 grid grid-cols-1 gap-px border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => (
          <article key={feature.title} className="bg-[var(--color-paper)] p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-accent)] nums-oldstyle">
              {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-4 font-display text-[24px] leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
              {feature.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-pretty text-[var(--fg-muted)]">
              {feature.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
