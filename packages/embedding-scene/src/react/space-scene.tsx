/* eslint-disable react/no-unknown-property -- R3F three-element props (position, args, intensity, ...) are not DOM attributes */
// Platform-agnostic R3F scene: category/project/post nodes as spheres,
// taxonomy/assignment/match edges as line segments. No DOM, no drei, no
// react-native imports — both hosts mount this inside their own <Canvas>.
import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
// Type-only import: loads R3F's JSX.IntrinsicElements augmentation and the
// event type without adding a runtime dependency on either fiber entry point
// (web hosts use '@react-three/fiber', native hosts '@react-three/fiber/native').
import type { ThreeEvent } from "@react-three/fiber";
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
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    return geo;
  }, [scene, kind]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={new Color(EDGE_COLOR[kind])} transparent opacity={0.45} />
    </lineSegments>
  );
}

export interface SpaceSceneProps {
  scene: EmbeddingScene;
  selectedId: string | null;
  neighborIds: Set<string>;
  onSelect: (id: string | null) => void;
}

export function SpaceScene({ scene, selectedId, neighborIds, onSelect }: SpaceSceneProps) {
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
        return (
          <mesh
            key={node.id}
            position={node.position}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              onSelect(active ? null : node.id);
            }}
          >
            <sphereGeometry args={[NODE_RADIUS[node.kind] * (active ? 1.8 : 1), 16, 16]} />
            <meshStandardMaterial
              color={NODE_COLOR[node.kind]}
              emissive={active || neighbor ? NODE_COLOR[node.kind] : "#000000"}
              emissiveIntensity={active ? 0.9 : neighbor ? 0.4 : 0}
              transparent
              opacity={selectedId && !active && !neighbor ? 0.25 : 1}
            />
          </mesh>
        );
      })}
    </group>
  );
}
