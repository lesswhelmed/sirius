"use client";

import { relatedPosts } from "@repo/embedding-scene/scene-queries";
import { useMemo } from "react";
import { useSceneClient } from "../../../(app)/space/use-scene-client";

export function RelatedPosts({ slug }: { slug: string }) {
  const scene = useSceneClient();

  const related = useMemo(() => {
    if (!scene) return [];
    const node = scene.nodes.find((n) => n.kind === "post" && n.slug === slug);
    return node ? relatedPosts(scene, node.id, 6) : [];
  }, [scene, slug]);

  if (related.length === 0) return null;

  return (
    <section
      aria-label="Related"
      className="mt-12 border-t border-[var(--color-rule)] pt-6"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        Related
      </p>
      <ul className="mt-3">
        {related.map((rp) => (
          <li
            key={rp.node.id}
            className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
          >
            <a
              href={rp.node.slug ? `/listing/${rp.node.slug}` : "#"}
              className="font-display italic text-[18px] text-[var(--fg)] transition-colors hover:text-[var(--color-accent)]"
            >
              {rp.node.label}
            </a>
            {rp.via[0] ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                via {rp.via[0].label}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
