/* eslint-disable react/no-unknown-property -- R3F three-element props (position, args, intensity, ...) are not DOM attributes */
// Platform-agnostic R3F scene: category/project/post nodes as spheres,
// taxonomy/assignment/match edges as line segments. No DOM, no drei, no
// react-native imports — both hosts mount this inside their own <Canvas>.

// Type-only import: loads R3F's JSX.IntrinsicElements augmentation and the
// event type without adding a runtime dependency on either fiber entry point
// (web hosts use '@react-three/fiber', native hosts '@react-three/fiber/native').
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import type { EmbeddingScene, SceneEdgeKind, SceneNode } from "../types";

const NODE_COLOR: Record<SceneNode["kind"], string> = {
  category: "#8a7bff",
  project: "#ffb84d",
  post: "#5fd4a2",
};

const NODE_RADIUS: Record<SceneNode["kind"], number> = {
  category: 0.14,
  project: 0.22,
  post: 0.1,
};

const EDGE_COLOR: Record<SceneEdgeKind, string> = {
  taxonomy: "#4a4660",
  assignment: "#b3863a",
  match: "#2f6e57",
};

function EdgeLines({
  scene,
  kind,
}: {
  scene: EmbeddingScene;
  kind: SceneEdgeKind;
}) {
  const geometry = useMemo(() => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n.position]));
    const verts: number[] = [];
    for (const e of scene.edges) {
      if (e.kind !== kind) continue;
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      verts.push(...a, ...b);
    }
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(verts), 3),
    );
    return geo;
  }, [scene, kind]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={new Color(EDGE_COLOR[kind])}
        transparent
        opacity={0.45}
      />
    </lineSegments>
  );
}

// Spheres are small relative to the camera distance, so each node also carries
// a larger invisible "hit halo" that receives pointer events — without it,
// landing a click on a 0.1-radius post is a dexterity test.
const HIT_RADIUS_FACTOR = 3;
const HIT_RADIUS_MIN = 0.4;

// Pointer cursor on hover (web only — react-native has no document).
function setHoverCursor(on: boolean): void {
  if (typeof document !== "undefined") {
    document.body.style.cursor = on ? "pointer" : "auto";
  }
}

export interface SpaceSceneProps {
  scene: EmbeddingScene;
  selectedId: string | null;
  neighborIds: Set<string>;
  onSelect: (id: string | null) => void;
  // Second click/tap on the already-selected category/project node. Hosts use
  // this to drill in (open the linked-posts index). Post nodes never drill —
  // a second click on a post deselects, as does omitting onDrill entirely.
  onDrill?: (id: string) => void;
}

export function SpaceScene({
  scene,
  selectedId,
  neighborIds,
  onSelect,
  onDrill,
}: SpaceSceneProps) {
  return (
    <group>
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 8]} intensity={0.7} />
      <EdgeLines scene={scene} kind="taxonomy" />
      <EdgeLines scene={scene} kind="assignment" />
      <EdgeLines scene={scene} kind="match" />
      {scene.nodes.map((node) => {
        const active = node.id === selectedId;
        const neighbor = neighborIds.has(node.id);
        const radius = NODE_RADIUS[node.kind];
        return (
          <group key={node.id} position={node.position}>
            {/* invisible hit halo — the actual click/tap target */}
            <mesh
              onClick={(event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                if (active) {
                  if (onDrill && node.kind !== "post") onDrill(node.id);
                  else onSelect(null);
                } else {
                  onSelect(node.id);
                }
              }}
              onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                event.stopPropagation();
                setHoverCursor(true);
              }}
              onPointerOut={() => setHoverCursor(false)}
            >
              <sphereGeometry
                args={[
                  Math.max(radius * HIT_RADIUS_FACTOR, HIT_RADIUS_MIN),
                  8,
                  8,
                ]}
              />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            {/* visible sphere */}
            <mesh>
              <sphereGeometry args={[radius * (active ? 1.8 : 1), 16, 16]} />
              <meshStandardMaterial
                color={NODE_COLOR[node.kind]}
                emissive={
                  active || neighbor ? NODE_COLOR[node.kind] : "#000000"
                }
                emissiveIntensity={active ? 0.9 : neighbor ? 0.4 : 0}
                transparent
                opacity={selectedId && !active && !neighbor ? 0.25 : 1}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
