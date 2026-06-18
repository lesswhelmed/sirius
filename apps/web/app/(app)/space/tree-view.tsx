"use client";

import { useMemo, useState } from "react";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import {
  categoryChildren,
  nodeCounts,
  projectNodes,
  subtreeIndex,
} from "@repo/embedding-scene/scene-queries";

// Branches shallower than this depth start open on first render; deeper ones
// collapse. Mirrors the mobile Tree tab's EXPAND_TO_DEPTH.
const EXPAND_TO_DEPTH = 1;

type Sub = "categories" | "focus";

// The Tree tab: the analysis taxonomy + focus areas as a desktop outline you
// dive into. Two panes — a pinned, expand/collapse outline on the left and a
// live "Index" of the selected branch's posts on the right. The native
// counterpart is apps/mobile/src/app/(tabs)/tree.tsx; both share every
// tree-shaping/drill query from @repo/embedding-scene so they can't disagree.
export function TreeView({ scene }: { scene: EmbeddingScene }) {
  const childrenMap = useMemo(() => categoryChildren(scene), [scene]);
  const projects = useMemo(() => projectNodes(scene), [scene]);
  const counts = useMemo(() => nodeCounts(scene), [scene]);
  const categoryCount = useMemo(
    () =>
      scene.nodes.reduce(
        (n, node) => n + (node.kind === "category" ? 1 : 0),
        0
      ),
    [scene]
  );

  const [sub, setSub] = useState<Sub>("categories");
  // Expand state keyed by category path. Lazy default: every branch with
  // children shallower than EXPAND_TO_DEPTH starts open. In-memory only (v1).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const node of scene.nodes) {
      if (node.kind !== "category" || node.path == null) continue;
      const hasChildren = (childrenMap.get(node.path) ?? []).length > 0;
      if (hasChildren && (node.depth ?? 0) < EXPAND_TO_DEPTH) set.add(node.path);
    }
    return set;
  });
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const index = useMemo(
    () => (drilledId ? subtreeIndex(scene, drilledId) : null),
    [scene, drilledId]
  );

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const categoriesEmpty = (childrenMap.get(null) ?? []).length === 0;

  return (
    <div className="hairline-t mt-7 flex h-[calc(100vh-8rem)] min-h-[420px] gap-6 pt-5">
      <style>{`
        @keyframes slip-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
        @keyframes entry-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div className="flex w-[22rem] shrink-0 flex-col overflow-hidden">
        <div
          role="tablist"
          aria-label="Tree view"
          className="flex items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          <SubTab
            active={sub === "categories"}
            label="Categories"
            count={categoryCount}
            onClick={() => setSub("categories")}
          />
          <SubTab
            active={sub === "focus"}
            label="Focus"
            count={projects.length}
            onClick={() => setSub("focus")}
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {sub === "categories" ? (
            categoriesEmpty ? (
              <p className="font-display italic text-[15px] text-[var(--fg-muted)]">
                No analysis branches yet.
              </p>
            ) : (
              <TreeBranch
                parent={null}
                childrenMap={childrenMap}
                counts={counts.subtree}
                expanded={expanded}
                drilledId={drilledId}
                onToggle={toggle}
                onPick={setDrilledId}
              />
            )
          ) : projects.length === 0 ? (
            <p className="font-display italic text-[15px] text-[var(--fg-muted)]">
              No focus areas yet. Assign posts to a project to see it here.
            </p>
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => (
                <FocusCard
                  key={p.id}
                  node={p}
                  count={counts.direct.get(p.id) ?? 0}
                  active={p.id === drilledId}
                  onPick={() => setDrilledId(p.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-paper-sunken)]">
        <IndexPane index={index} />
      </div>
    </div>
  );
}

function SubTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex items-baseline gap-1.5 pb-1 transition-colors ${
        active
          ? "text-[var(--color-accent)]"
          : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
      }`}
    >
      {label}
      <span className="nums-lining text-[var(--fg-subtle)]">{count}</span>
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-px transition-colors ${
          active ? "bg-[var(--color-accent)]" : "bg-transparent"
        }`}
      />
    </button>
  );
}

// Recursive outline branch — the web twin of the Map sidebar's TreeBranch, plus
// disclosure carets + per-node counts. Recursion descends only into EXPANDED
// branches. The caret toggles; the label drills.
function TreeBranch({
  parent,
  childrenMap,
  counts,
  expanded,
  drilledId,
  onToggle,
  onPick,
}: {
  parent: string | null;
  childrenMap: Map<string | null, SceneNode[]>;
  counts: Map<string, number>;
  expanded: Set<string>;
  drilledId: string | null;
  onToggle: (path: string) => void;
  onPick: (id: string) => void;
}) {
  const nodes = childrenMap.get(parent) ?? [];
  if (nodes.length === 0) return null;
  return (
    <ul
      className={parent == null ? "" : "ml-3 border-l border-[var(--color-rule)] pl-2"}
    >
      {nodes.map((n) => {
        const path = n.path ?? null;
        const hasChildren =
          path != null && (childrenMap.get(path) ?? []).length > 0;
        const isOpen = path != null && expanded.has(path);
        return (
          <li key={n.id}>
            <NodeRow
              node={n}
              count={counts.get(n.id) ?? 0}
              hasChildren={hasChildren}
              isOpen={isOpen}
              active={n.id === drilledId}
              onToggle={hasChildren && path != null ? () => onToggle(path) : undefined}
              onPick={() => onPick(n.id)}
            />
            {hasChildren && isOpen ? (
              <TreeBranch
                parent={path}
                childrenMap={childrenMap}
                counts={counts}
                expanded={expanded}
                drilledId={drilledId}
                onToggle={onToggle}
                onPick={onPick}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NodeRow({
  node,
  count,
  hasChildren,
  isOpen,
  active,
  onToggle,
  onPick,
}: {
  node: SceneNode;
  count: number;
  hasChildren: boolean;
  isOpen: boolean;
  active: boolean;
  // undefined for leaves — they get a spacer, no caret.
  onToggle?: () => void;
  onPick: () => void;
}) {
  return (
    <div className="flex items-baseline gap-1">
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded={isOpen}
          className="w-4 shrink-0 self-center text-center font-mono text-[10px] leading-none text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
        >
          {isOpen ? "▾" : "▸"}
        </button>
      ) : (
        <span aria-hidden="true" className="w-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onPick}
        className={`flex min-w-0 flex-1 items-baseline gap-2 py-0.5 text-left transition-colors ${
          active
            ? "text-[var(--color-accent)]"
            : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate font-display text-[15px] leading-snug ${
            active ? "italic" : ""
          }`}
        >
          {node.label}
        </span>
        {count > 0 ? (
          <span className="font-mono text-[10px] nums-lining text-[var(--fg-subtle)]">
            {count}
          </span>
        ) : (
          <span aria-hidden="true" className="font-mono text-[10px] text-[var(--color-rule)]">
            ·
          </span>
        )}
      </button>
    </div>
  );
}

function FocusCard({
  node,
  count,
  active,
  onPick,
}: {
  node: SceneNode;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full items-center justify-between gap-3 border bg-[var(--color-paper-raised)] px-4 py-3 text-left transition-colors ${
          active
            ? "border-[var(--color-accent)]"
            : "border-[var(--color-rule)] hover:border-[var(--color-rule-strong)]"
        }`}
      >
        <span className="min-w-0">
          <span className="block font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
            Focus area
          </span>
          <span
            className={`mt-0.5 block truncate font-display text-[18px] leading-snug ${
              active ? "italic text-[var(--color-accent)]" : "text-[var(--fg)]"
            }`}
          >
            {node.label}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] nums-lining text-[var(--fg-subtle)]">
          {count} {count === 1 ? "post" : "posts"}
        </span>
      </button>
    </li>
  );
}

// The right pane — "The Index" of whatever branch is selected. Reuses the visual
// language of the Map tab's IndexPanel: numbered journal entries, match scores
// where the link is a similarity, Open → links to the listing.
function IndexPane({
  index,
}: {
  index: ReturnType<typeof subtreeIndex>;
}) {
  if (!index) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-[16rem] text-center font-display italic text-[15px] leading-snug text-[var(--fg-muted)]">
          Pick a branch to open its index.
        </p>
      </div>
    );
  }

  const { root } = index;
  const kicker =
    root.kind === "category"
      ? (root.path ?? root.label).replace(/\//g, " / ")
      : `focus / ${root.label}`;

  return (
    <div
      key={root.id}
      className="flex h-full animate-[slip-in_320ms_cubic-bezier(0.22,1,0.36,1)_both] flex-col"
    >
      <header className="border-b border-[var(--color-rule)] p-4">
        <p className="break-all font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Index — {kicker}
        </p>
        <h3 className="mt-1 font-display italic text-[24px] leading-tight text-[var(--fg)]">
          {root.label}
        </h3>
        {root.purpose ? (
          <p className="mt-1.5 font-display italic text-[13px] leading-snug text-[var(--fg-muted)]">
            {root.purpose}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          {index.total === 1 ? "1 entry" : `${index.total} entries`}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {index.total === 0 ? (
          <p className="p-4 font-display italic text-[14px] text-[var(--fg-muted)]">
            Nothing filed here yet.
          </p>
        ) : index.multiNode ? (
          <div className="divide-y divide-[var(--color-rule)]/60">
            {index.groups.map((g) => (
              <section key={g.node.id} className="p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                  {g.node.label}
                </p>
                <ol className="mt-2">
                  {g.posts.map((entry, idx) => (
                    <IndexRow key={entry.node.id} entry={entry} n={idx + 1} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <ol className="p-4">
            {(index.groups[0]?.posts ?? []).map((entry, idx) => (
              <IndexRow key={entry.node.id} entry={entry} n={idx + 1} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function IndexRow({
  entry,
  n,
}: {
  entry: { node: SceneNode; weight?: number };
  n: number;
}) {
  return (
    <li
      className="animate-[entry-in_260ms_ease-out_both] list-none border-b border-[var(--color-rule)]/40 last:border-b-0"
      style={{ animationDelay: `${Math.min((n - 1) * 35, 350)}ms` }}
    >
      <div className="group flex items-baseline gap-2.5 py-2.5 transition-colors hover:bg-[var(--color-ink)]/[0.04]">
        <span className="font-mono text-[10px] nums-lining text-[var(--fg-subtle)]">
          {String(n).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] leading-snug text-[var(--fg)]">
            {entry.node.label}
          </p>
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
  );
}
