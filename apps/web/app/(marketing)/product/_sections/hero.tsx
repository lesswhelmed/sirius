import Image from "next/image";
import { DEMO_VIDEO, DEMO_VIDEO_READY, SCREENS } from "../../constants";
import { CtaPair, Eyebrow } from "./primitives";

export function Hero() {
  return (
    <section className="grid grid-cols-1 items-center gap-12 pt-10 pb-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-16 lg:pb-24">
      <div className="order-2 lg:order-1">
        <Eyebrow>A personal content catalog</Eyebrow>
        <h1 className="mt-5 font-display text-[clamp(2.75rem,7vw,5rem)] leading-[0.98] tracking-[-0.02em] text-balance text-[var(--color-ink)]">
          Everything you capture, drafted into something{" "}
          <em className="italic text-[var(--color-accent)]">worth keeping.</em>
        </h1>
        <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-pretty text-[var(--fg-muted)]">
          Sirius takes the links, photos, notes, repositories, videos, documents,
          and voice memos you throw at it — and drafts a clean, organized post with
          AI. You review, then keep it private or publish it to your catalog.
        </p>
        <div className="mt-9">
          <CtaPair />
        </div>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          iOS &amp; Web · Drafts on-device on iPhone · No tracking
        </p>
      </div>

      <div className="order-1 lg:order-2">
        <HeroMedia />
      </div>
    </section>
  );
}

// The hero artifact, framed as a catalog specimen: a labelled plate that holds
// the live demo (once produced) or a real in-app screenshot until then.
function HeroMedia() {
  return (
    <figure className="paper-card mx-auto w-full max-w-[360px] p-3">
      <figcaption className="hairline-b flex items-center justify-between gap-3 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--fg-subtle)]">
        <span>Specimen · Demo</span>
        <span className="text-[var(--color-accent)]">Capture → Catalog</span>
      </figcaption>
      <div className="relative mt-3 aspect-[1320/2868] w-full overflow-hidden bg-[var(--color-paper-sunken)]">
        {DEMO_VIDEO_READY ? (
          <video
            className="h-full w-full object-cover"
            poster={DEMO_VIDEO.poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          >
            <source src={DEMO_VIDEO.webm} type="video/webm" />
            <source src={DEMO_VIDEO.mp4} type="video/mp4" />
          </video>
        ) : (
          <Image
            src={SCREENS.capture}
            alt="The Sirius capture screen on iPhone"
            fill
            sizes="(max-width: 1024px) 80vw, 360px"
            className="object-cover"
            priority
          />
        )}
      </div>
    </figure>
  );
}
