import { CtaBlock, Eyebrow } from "./primitives";

export function Closing() {
  return (
    <section className="py-20 lg:py-28">
      {/* Privacy callout */}
      <div className="mx-auto max-w-2xl text-center">
        <Eyebrow className="text-center">On privacy</Eyebrow>
        <p className="mt-5 font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[1.1] tracking-[-0.01em] text-balance text-[var(--color-ink)]">
          No third-party advertising. No cross-app tracking.
        </p>
        <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-pretty text-[var(--fg-muted)]">
          Your originals stay private, and you can export everything you&apos;ve
          put in, whenever you want. Nothing is published unless you choose to
          publish it.
        </p>
      </div>

      {/* Final CTA */}
      <div className="rule-emphatic-t mt-20 flex flex-col items-center gap-8 pt-16 text-center">
        <h2 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.98] tracking-[-0.02em] text-balance text-[var(--color-ink)]">
          Start saving your context.
        </h2>
        <p className="-mt-2 max-w-md text-[15px] leading-relaxed text-pretty text-[var(--fg-muted)]">
          Stop losing the context of your life to a hundred open tabs. Capture
          it, and let Lesswhelmed turn it into something you can actually use. Feel
          lesswhelmed.
        </p>
        <CtaBlock align="center" />
      </div>
    </section>
  );
}
