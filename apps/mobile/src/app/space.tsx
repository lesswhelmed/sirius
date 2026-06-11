// 3D embedding space. Same SpaceScene + selection hook as web; native host
// differs only in Canvas import, camera control (pan-to-orbit), and overlay.
import { Canvas, useThree } from "@react-three/fiber/native";
import type { ThreeEvent } from "@react-three/fiber";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BackSide } from "three";
import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { linkedPosts } from "@repo/embedding-scene/scene-queries";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

import { apiGet } from "../lib/api";

// Orbit by dragging empty space. Fiber/native's Canvas claims every touch
// before any RN PanResponder on an ancestor View can (its internal responder
// wins the capture phase), so the drag surface must live INSIDE the R3F event
// system: an inside-out sphere around the scene catches pointer drags that
// miss every node, while taps on node halos still win the raycast (nearer hit).
function OrbitBackdrop({
  onDelta,
}: {
  onDelta: (dx: number, dy: number) => void;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <mesh
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        last.current = { x: e.pointer.x, y: e.pointer.y };
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        if (!last.current) return;
        onDelta(e.pointer.x - last.current.x, e.pointer.y - last.current.y);
        last.current = { x: e.pointer.x, y: e.pointer.y };
      }}
      onPointerUp={() => {
        last.current = null;
      }}
    >
      <sphereGeometry args={[60, 8, 8]} />
      <meshBasicMaterial side={BackSide} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function OrbitRig({ yaw, pitch }: { yaw: number; pitch: number }) {
  // Camera orbits the origin at fixed radius, driven by pan gestures.
  // Deviation from the plan's `<perspectiveCamera makeDefault>`: `makeDefault`
  // is a drei prop, not raw R3F (no drei on native), so that element would
  // never become the render camera — drive the canvas default camera instead.
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const radius = 18;
    camera.position.set(
      radius * Math.cos(pitch) * Math.sin(yaw),
      radius * Math.sin(pitch),
      radius * Math.cos(pitch) * Math.cos(yaw)
    );
    camera.lookAt(0, 0, 0);
  }, [camera, yaw, pitch]);
  return null;
}

export default function SpaceScreen() {
  const router = useRouter();
  const [scene, setScene] = useState<EmbeddingScene | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<EmbeddingScene>("/api/app/embedding-scene")
      .then(setScene)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed to load"));
  }, []);

  // Hook needs a scene; render gate first.
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!scene) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading space…</Text>
      </View>
    );
  }
  return <LoadedSpace scene={scene} onOpenPost={(slug) => router.push(`/post/${slug}`)} />;
}

function LoadedSpace({
  scene,
  onOpenPost,
}: {
  scene: EmbeddingScene;
  onOpenPost: (slug: string) => void;
}) {
  const [orbit, setOrbit] = useState({ yaw: 0.6, pitch: 0.35 });
  const onOrbitDelta = useCallback((dx: number, dy: number) => {
    // deltas arrive in NDC units (-1..1 across the canvas); ~2.5 rad per
    // full-width drag feels right for a thumb.
    setOrbit(({ yaw, pitch }) => ({
      yaw: yaw - dx * 2.5,
      pitch: Math.min(1.4, Math.max(-1.4, pitch - dy * 2)),
    }));
  }, []);
  const { selected, select, neighborIds } = useSceneSelection(scene);
  // Second tap on the selected node opens "The Index": every post linked to it.
  const [drilledId, setDrilledId] = useState<string | null>(null);
  const drilledEntries = useMemo(
    () => (drilledId ? linkedPosts(scene, drilledId) : []),
    [scene, drilledId]
  );
  const handleSelect = useCallback(
    (id: string | null) => {
      select(id);
      setDrilledId((cur) => (id === null || (cur && id !== cur) ? null : cur));
    },
    [select]
  );
  const openSelected = useCallback(() => {
    if (selected?.slug) onOpenPost(selected.slug);
  }, [selected, onOpenPost]);
  return (
    <View style={styles.root}>
      <Canvas camera={{ fov: 50 }}>
        <OrbitRig yaw={orbit.yaw} pitch={orbit.pitch} />
        <OrbitBackdrop onDelta={onOrbitDelta} />
        <SpaceScene
          scene={scene}
          selectedId={selected?.id ?? null}
          neighborIds={neighborIds}
          onSelect={handleSelect}
          onDrill={setDrilledId}
        />
      </Canvas>
      {selected ? (
        <View style={styles.overlay}>
          <Text style={styles.kind}>
            {selected.kind === "category"
              ? (selected.path ?? selected.label).split("/").join(" / ")
              : selected.kind}
          </Text>
          <Text style={styles.label}>{selected.label}</Text>
          {selected.purpose ? (
            <Text style={styles.purpose}>{selected.purpose}</Text>
          ) : null}
          <View style={styles.overlayActions}>
            {selected.slug ? (
              <Pressable onPress={openSelected}>
                <Text style={styles.link}>open post</Text>
              </Pressable>
            ) : null}
            {selected.kind !== "post" && drilledId !== selected.id ? (
              <Pressable onPress={() => setDrilledId(selected.id)}>
                <Text style={styles.link}>tap again for the index</Text>
              </Pressable>
            ) : null}
          </View>
          {drilledId === selected.id ? (
            <View style={styles.index}>
              <Text style={styles.kind}>
                Index · {drilledEntries.length}{" "}
                {drilledEntries.length === 1 ? "entry" : "entries"}
              </Text>
              <ScrollView style={styles.indexList}>
                {drilledEntries.length === 0 ? (
                  <Text style={styles.muted}>Nothing filed here yet.</Text>
                ) : (
                  drilledEntries.map((entry, idx) => (
                    <Pressable
                      key={entry.node.id}
                      style={styles.indexRow}
                      onPress={() => {
                        if (entry.node.slug) onOpenPost(entry.node.slug);
                      }}
                    >
                      <Text style={styles.indexNum}>
                        {String(idx + 1).padStart(2, "0")}
                      </Text>
                      <Text style={styles.indexLabel} numberOfLines={1}>
                        {entry.node.label}
                      </Text>
                      {entry.weight != null ? (
                        <Text style={styles.indexScore}>
                          {entry.weight.toFixed(2)}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0b0f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: "#888" },
  error: { color: "#e66" },
  overlay: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    borderRadius: 8,
    backgroundColor: "rgba(17,17,22,0.92)",
    padding: 12,
  },
  kind: { color: "#888", fontSize: 11, textTransform: "uppercase" },
  label: { color: "#eee", fontSize: 15, fontWeight: "600" },
  purpose: { color: "#aaa", fontSize: 13, fontStyle: "italic", marginTop: 4 },
  overlayActions: { flexDirection: "row", gap: 16 },
  link: { color: "#9bd", marginTop: 6, textDecorationLine: "underline" },
  index: {
    borderTopColor: "rgba(136,136,136,0.35)",
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 8,
  },
  indexList: { maxHeight: 220, marginTop: 4 },
  indexRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 8,
    paddingVertical: 6,
  },
  indexNum: { color: "#777", fontSize: 10, fontVariant: ["tabular-nums"] },
  indexLabel: { color: "#ddd", flex: 1, fontSize: 14 },
  indexScore: { color: "#7da", fontSize: 10 },
});
