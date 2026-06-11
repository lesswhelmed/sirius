"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

// Build the taxonomy tree (category nodes only) for the side panel.
function categoryChildren(
  scene: EmbeddingScene
): Map<string | null, SceneNode[]> {
  const children = new Map<string | null, SceneNode[]>();
  for (const n of scene.nodes) {
    if (n.kind !== "category") continue;
    const parent = n.path?.includes("/")
      ? n.path.slice(0, n.path.lastIndexOf("/"))
      : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  return children;
}

function TreeBranch({
  parent,
  childrenMap,
  selectedId,
  onSelect,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <ul className="ml-3 border-l border-[var(--color-rule)] pl-2">
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id === selectedId ? null : n.id)}
            className={`block py-0.5 text-left font-display text-[15px] leading-snug transition-colors ${
              n.id === selectedId
                ? "italic text-[var(--color-accent)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            {n.label}
          </button>
          <TreeBranch
            parent={n.path ?? null}
            childrenMap={childrenMap}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

export function SpaceView({ scene }: { scene: EmbeddingScene }) {
  const { selected, select, neighborIds } = useSceneSelection(scene);
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  return (
    <section>
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Section V — The Observatory
        </p>
        <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] sm:text-[48px]">
          The Space<span className="text-[var(--color-accent)]">.</span>
        </h1>
        <p className="mt-3 max-w-md font-display italic text-[17px] leading-snug text-[var(--fg-muted)]">
          Every analysis branch, focus area, and filed post plotted by meaning.
          Drag to orbit; click a sphere or a branch to inspect it.
        </p>
      </header>

      <div className="hairline-t mt-7 flex h-[calc(100vh-8rem)] min-h-[420px] gap-6 pt-5">
        <aside className="w-64 shrink-0 overflow-y-auto">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Analysis tree
          </h2>
          <div className="mt-3">
            <TreeBranch
              parent={null}
              childrenMap={childrenMap}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
          </div>
        </aside>
        <div className="relative min-w-0 flex-1 border border-[var(--color-rule)] bg-[var(--color-ink)]">
          <Canvas
            camera={{ position: [0, 4, 18], fov: 50 }}
            onPointerMissed={() => select(null)}
          >
            <SpaceScene
              scene={scene}
              selectedId={selected?.id ?? null}
              neighborIds={neighborIds}
              onSelect={select}
            />
            <OrbitControls enableDamping makeDefault />
          </Canvas>
          {selected ? (
            <div className="absolute bottom-3 left-3 max-w-sm border border-[var(--color-rule)] bg-[var(--color-paper)]/95 p-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                {selected.kind}
              </span>
              <p className="font-display text-[17px] leading-snug text-[var(--fg)]">
                {selected.label}
              </p>
              {selected.slug ? (
                <a
                  className="mt-1 inline-block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] underline underline-offset-4"
                  href={`/listing/${selected.slug}`}
                >
                  Open post →
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
