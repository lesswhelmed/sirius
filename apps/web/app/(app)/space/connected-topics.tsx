"use client";

import { relatedCategories } from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useMemo } from "react";

export function ConnectedTopics({
  scene,
  node,
  onOpenTopic,
}: {
  scene: EmbeddingScene;
  node: SceneNode; // the drilled node (page head)
  onOpenTopic: (categoryId: string) => void;
}) {
  const related = useMemo(
    () => (node.kind === "category" ? relatedCategories(scene, node.id, 6) : []),
    [scene, node],
  );

  // Parent topic up-link, found via the drilled category's authoritative
  // parentPath (a category's id IS its path). Null at top level / for projects.
  const parent = useMemo(() => {
    if (node.kind !== "category" || node.parentPath == null) return null;
    return (
      scene.nodes.find(
        (n) => n.kind === "category" && n.path === node.parentPath,
      ) ?? null
    );
  }, [scene, node]);

  if (!parent && related.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-rule)] p-3">
      {parent ? (
        <button
          type="button"
          onClick={() => onOpenTopic(parent.id)}
          className="mb-2 block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
        >
          ↑ {parent.label}
        </button>
      ) : null}

      {related.length > 0 ? (
        <>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Connected topics
          </p>
          <ul className="mt-2">
            {related.map((rc) => (
              <li
                key={rc.node.id}
                className="border-b border-[var(--color-rule)]/60"
              >
                <button
                  type="button"
                  onClick={() => onOpenTopic(rc.node.id)}
                  className="group flex w-full items-baseline justify-between gap-2.5 py-2 text-left transition-colors hover:bg-[var(--color-ink)]/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate font-display text-[15px] leading-snug text-[var(--fg)] group-hover:text-[var(--color-accent)]">
                    {rc.node.label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                    {rc.shared} shared
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
