import { Asterism } from "./primitives";

const HOOKS = [
  "Capture now. Sorted later.",
  "AI drafts it. You decide what's worth keeping.",
  "Your stuff — drafted, organized, and still yours.",
] as const;

// A quiet pull-quote band. The boldness is spent on the hero and the
// transformation; here the type is large but the treatment is disciplined.
export function SellingPoints() {
  return (
    <section className="surface-sunken -mx-5 px-5 py-20 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12 lg:py-28">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-10 text-center">
        {HOOKS.map((hook, i) => (
          <div key={hook} className="flex flex-col items-center gap-10">
            {i > 0 && <Asterism className="text-xl" />}
            <p className="font-display text-[clamp(1.75rem,4vw,3rem)] leading-[1.05] tracking-[-0.01em] text-balance text-[var(--color-ink)]">
              {hook}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
