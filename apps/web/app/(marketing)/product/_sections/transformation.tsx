import { Asterism, Eyebrow } from "./primitives";

// The signature moment: the same capture shown as raw input on the left and as
// a finished catalog entry on the right. It demonstrates the core promise
// without a screenshot — the typography itself tells the before/after story.
export function Transformation() {
  return (
    <section className="rule-double-b border-t border-[var(--color-rule)] py-16 lg:py-24">
      <div className="text-center">
        <Eyebrow className="text-center">The whole point</Eyebrow>
        <h2 className="mx-auto mt-4 max-w-3xl font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.02] tracking-[-0.01em] text-balance text-[var(--color-ink)]">
          From clutter to context.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-pretty text-[var(--fg-muted)]">
          Paste a link or jot a note. Sirius reads what you gave it, writes the
          title, summary, tags, and details, and files it as context you can use
          later. On iPhone it can even draft on-device.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 items-center gap-6 sm:mt-14 lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
        {/* Raw input */}
        <div className="surface-sunken p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
            Raw · what you paste
          </p>
          <div className="mt-5 space-y-4 font-mono text-[13px] leading-relaxed text-[var(--fg-muted)]">
            <p className="break-words text-[var(--color-accent)]">
              https://example.com/a-very-long-article-you-meant-to-read
            </p>
            <p className="text-[var(--fg-subtle)]">
              + “remember this for the kitchen reno thing — the bit about
              cabinet hardware”
            </p>
          </div>
        </div>

        {/* Connector */}
        <div className="flex items-center justify-center py-2 lg:px-2">
          <Asterism className="text-2xl" />
        </div>

        {/* Finished entry */}
        <article className="paper-card p-6">
          <div className="hairline-b flex items-center justify-between gap-3 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
            <span>Context · what you get</span>
            <span className="nums-oldstyle">No. 001 · Finding</span>
          </div>
          <h3 className="mt-4 font-display text-[26px] leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
            Cabinet hardware that earns its keep
          </h3>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-muted)]">
            A clean summary of the article, pulled together with your note — the
            argument for solid-brass pulls, the trade-offs, and the one detail
            you wanted to keep.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["renovation", "kitchen", "hardware", "finding"].map((tag) => (
              <span
                key={tag}
                className="border border-[var(--color-rule)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
