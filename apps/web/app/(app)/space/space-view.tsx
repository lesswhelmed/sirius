"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";
import {
  categoryChildren,
  type linkedPosts,
} from "@repo/embedding-scene/scene-queries";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import { useMemo, useState } from "react";
import { TreeView } from "./tree-view";

function TreeBranch({
  parent,
  childrenMap,
  selectedId,
  onSelect,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  selectedId: string | null;
  // first click selects; the parent decides what a repeat click means (drill)
  onSelect: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <ul className="ml-3 border-l border-[var(--color-rule)] pl-2">
      {nodes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id)}
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

// "The Index" — the drill-in catalog slip. Second click on a selected node
// slides this out of the observatory plate: every post linked to that node,
// numbered like journal entries, with match scores where the link is a
// similarity rather than a fact.
function IndexPanel({
  node,
  entries,
  onClose,
  onFocus,
}: {
  node: SceneNode;
  entries: ReturnType<typeof linkedPosts>;
  onClose: () => void;
  onFocus: (id: string) => void;
}) {
  // Only categories and projects drill into an index; posts never reach here.
  const kicker =
    node.kind === "category"
      ? (node.path ?? node.label).replace(/\//g, " / ")
      : `focus / ${node.label}`;
  const ruleColor =
    node.kind === "category"
      ? "var(--color-node-category)"
      : "var(--color-node-default)";
  return (
    <aside
      aria-label={`Posts linked to ${node.label}`}
      className="absolute inset-y-3 right-3 flex w-[19rem] animate-[slip-in_320ms_cubic-bezier(0.22,1,0.36,1)_both] flex-col border border-[var(--color-rule)] bg-[var(--color-paper)]/[0.97] shadow-[0_2px_24px_rgba(0,0,0,0.35)]"
      style={{ borderLeft: `3px solid ${ruleColor}` }}
    >
      <style>{`
        @keyframes slip-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
        @keyframes entry-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
      <header className="border-b border-[var(--color-rule)] p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="break-all font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Index — {kicker}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close index"
            className="-mt-0.5 font-mono text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            ✕
          </button>
        </div>
        <h3 className="mt-1 font-display italic text-[22px] leading-tight text-[var(--fg)]">
          {node.label}
        </h3>
        {node.purpose ? (
          <p className="mt-1.5 font-display italic text-[13px] leading-snug text-[var(--fg-muted)]">
            {node.purpose}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          {entries.length === 1 ? "1 entry" : `${entries.length} entries`}
        </p>
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <li className="p-3 font-display italic text-[14px] text-[var(--fg-muted)]">
            Nothing filed here yet.
          </li>
        ) : (
          entries.map((entry, idx) => (
            <li
              key={entry.node.id}
              className="animate-[entry-in_260ms_ease-out_both] border-b border-[var(--color-rule)]/60"
              style={{ animationDelay: `${Math.min(idx * 35, 350)}ms` }}
            >
              <div className="group flex items-baseline gap-2.5 p-3 transition-colors hover:bg-[var(--color-ink)]/[0.04]">
                <span className="font-mono text-[10px] text-[var(--fg-subtle)]">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onFocus(entry.node.id)}
                    title="Locate in space"
                    className="block w-full truncate text-left font-display text-[15px] leading-snug text-[var(--fg)] group-hover:text-[var(--color-accent)]"
                  >
                    {entry.node.label}
                  </button>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    {entry.weight != null ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                        match {entry.weight.toFixed(2)}
                      </span>
                    ) : (
                      <span />
                    )}
                    {entry.node.slug ? (
                      <a
                        href={`/listing/${entry.node.slug}`}
                        className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-accent)] underline underline-offset-2"
                      >
                        Open →
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))
        )}
      </ol>
    </aside>
  );
}

const TABS: { key: "map" | "tree"; label: string; hint: string }[] = [
  { key: "map", label: "Map", hint: "3D" },
  { key: "tree", label: "Tree", hint: "Outline" },
];

export function SpaceView({ scene }: { scene: EmbeddingScene }) {
  const [tab, setTab] = useState<"map" | "tree">("map");
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
          Drag to orbit a sphere, or browse the tree to dive into a branch.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Observatory views"
        className="mt-6 inline-flex border border-[var(--color-rule-strong)]"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex items-baseline gap-2 border-r border-[var(--color-rule-strong)] px-5 py-2.5 font-mono text-[13px] uppercase tracking-[0.18em] transition-colors last:border-r-0 ${
                active
                  ? "bg-[var(--color-accent)] text-[var(--color-paper)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--color-ink)]/[0.05] hover:text-[var(--fg)]"
              }`}
            >
              {t.label}
              <span
                aria-hidden="true"
                className={`text-[10px] tracking-[0.12em] ${
                  active
                    ? "text-[var(--color-paper)]/70"
                    : "text-[var(--fg-subtle)]"
                }`}
              >
                {t.hint}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "map" ? <MapView scene={scene} /> : <TreeView scene={scene} />}
    </section>
  );
}

function MapView({ scene }: { scene: EmbeddingScene }) {
  const {
    selected,
    select,
    neighborIds,
    drilled,
    drilledEntries,
    drill,
    closeDrill,
  } = useSceneSelection(scene);
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  // first click selects; a repeat click on the same node opens The Index
  const pick = (id: string) => {
    if (id === selected?.id) drill(id);
    else select(id);
  };
  return (
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
            onSelect={pick}
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
            onDrill={drill}
          />
          <OrbitControls enableDamping makeDefault />
        </Canvas>
        {selected ? (
          <div className="absolute bottom-3 left-3 max-w-sm border border-[var(--color-rule)] bg-[var(--color-paper)]/95 p-3">
            <span className="break-all font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              {selected.kind === "category"
                ? (selected.path ?? selected.label).replace(/\//g, " / ")
                : selected.kind}
            </span>
            <p className="font-display text-[17px] leading-snug text-[var(--fg)]">
              {selected.label}
            </p>
            {selected.purpose ? (
              <p className="mt-1 font-display italic text-[13px] leading-snug text-[var(--fg-muted)]">
                {selected.purpose}
              </p>
            ) : null}
            <div className="mt-1.5 flex items-baseline gap-3">
              {selected.slug ? (
                <a
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)] underline underline-offset-4"
                  href={`/listing/${selected.slug}`}
                >
                  Open post →
                </a>
              ) : null}
              {selected.kind !== "post" && drilled?.id !== selected.id ? (
                <button
                  type="button"
                  onClick={() => drill(selected.id)}
                  className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] underline underline-offset-4 hover:text-[var(--fg)]"
                >
                  Click again for the index
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {drilled ? (
          <IndexPanel
            node={drilled}
            entries={drilledEntries}
            onClose={closeDrill}
            onFocus={select}
          />
        ) : null}
      </div>
    </div>
  );
}
