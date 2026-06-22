"use client";

import { resurfacing } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { todaySeed } from "./use-scene-client";

export function RediscoverRail({
  scene,
  onOpenTopic,
}: {
  scene: EmbeddingScene;
  // When provided (Map view), opens a topic into the plate's Index in place.
  onOpenTopic?: (categoryId: string) => void;
}) {
  const picks = useMemo(() => resurfacing(scene, todaySeed()), [scene]);
  const { spotlight, connection, frontier } = picks;
  if (!spotlight && !connection && !frontier) return null;

  return (
    <section
      aria-label="Rediscover"
      className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {spotlight ? (
        <RailCard eyebrow="Rediscover">
          {spotlight.slug ? (
            <a
              href={`/listing/${spotlight.slug}`}
              className="block font-display text-[18px] leading-snug text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
            >
              {spotlight.label}
            </a>
          ) : (
            <span className="font-display text-[18px] leading-snug text-[var(--fg)]">
              {spotlight.label}
            </span>
          )}
        </RailCard>
      ) : null}

      {connection ? (
        <RailCard eyebrow="These connect">
          <TopicAction
            node={connection.via}
            onOpenTopic={onOpenTopic}
            className="block text-left"
          >
            <span className="block truncate font-display text-[16px] leading-snug text-[var(--fg)]">
              {connection.a.label}
            </span>
            <span className="font-mono text-[12px] text-[var(--color-accent)]">
              ＋
            </span>
            <span className="block truncate font-display text-[16px] leading-snug text-[var(--fg)]">
              {connection.b.label}
            </span>
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
              via {connection.via.label}
            </span>
          </TopicAction>
        </RailCard>
      ) : null}

      {frontier ? (
        <RailCard eyebrow="Unexplored corner">
          <TopicAction
            node={frontier}
            onOpenTopic={onOpenTopic}
            className="block text-left"
          >
            <span className="block font-display text-[18px] leading-snug text-[var(--fg)]">
              {frontier.label}
            </span>
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
              A quiet corner — add more here
            </span>
          </TopicAction>
        </RailCard>
      ) : null}
    </section>
  );
}

// Topic opener: a button when the host can drill in place (Map), otherwise inert
// static markup (Tree/standalone) — the topic still reads, just isn't clickable.
function TopicAction({
  node,
  onOpenTopic,
  className,
  children,
}: {
  node: SceneNode;
  onOpenTopic?: (categoryId: string) => void;
  className?: string;
  children: ReactNode;
}) {
  if (!onOpenTopic) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpenTopic(node.id)}
      className={`${className ?? ""} w-full`}
    >
      {children}
    </button>
  );
}

function RailCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="surface-raised flex flex-col gap-1.5 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {eyebrow}
      </p>
      {children}
    </div>
  );
}
