import Image from "next/image";
import { SCREENS } from "../../constants";
import { Eyebrow, Folio } from "./primitives";

// A genuine sequence — capture leads to a draft, which you curate, then publish
// — so the roman-numeral folios encode real order, not decoration.
const STEPS = [
  {
    folio: "I",
    title: "Capture",
    body: "Paste a link, snap a photo, jot a note, or record a voice memo. The iOS share sheet means anything can land in Sirius in two taps.",
    screen: SCREENS.capture,
    alt: "The Sirius capture screen",
  },
  {
    folio: "II",
    title: "Draft",
    body: "Sirius reads what you submitted and writes a structured post — title, summary, tags, and details — that you review before keeping.",
    screen: SCREENS.post,
    alt: "A finished post detail screen",
  },
  {
    folio: "III",
    title: "Organize",
    body: "Everything lands in your catalog and sorts itself by theme. The Tree groups related entries so your collection stays navigable.",
    screen: SCREENS.tree,
    alt: "The Tree taxonomy screen",
  },
  {
    folio: "IV",
    title: "Publish",
    body: "Keep an entry private, or publish it to your own catalog. Visitors can reach you through an inquiry form on your public page.",
    screen: SCREENS.catalog,
    alt: "The catalog library screen",
  },
] as const;

export function Flow() {
  return (
    <section className="py-16 lg:py-24">
      <div className="hairline-b flex items-end justify-between gap-4 pb-4">
        <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.75rem)] leading-none tracking-[-0.01em] text-[var(--color-ink)]">
          How it works
        </h2>
        <Eyebrow>Capture · Draft · Organize · Publish</Eyebrow>
      </div>

      <ol className="mt-12 grid grid-cols-1 gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.folio} className="flex flex-col">
            <div className="relative aspect-[1320/2868] w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
              <Image
                src={step.screen}
                alt={step.alt}
                fill
                sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 22vw"
                className="object-cover object-top"
              />
            </div>
            <div className="mt-5 flex items-baseline gap-3">
              <Folio>{step.folio}</Folio>
              <h3 className="font-display text-[22px] leading-none tracking-[-0.01em] text-[var(--color-ink)]">
                {step.title}
              </h3>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-pretty text-[var(--fg-muted)]">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
