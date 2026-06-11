// 3D embedding space. Same SpaceScene + selection hook as web; native host
// differs only in Canvas import, camera control (pan-to-orbit), and overlay.
import { Canvas, useThree } from "@react-three/fiber/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { linkedPosts } from "@repo/embedding-scene/scene-queries";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";

import { apiGet } from "../lib/api";

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
  const [orbit, setOrbit] = useState({ yaw: 0.6, pitch: 0.35 });

  useEffect(() => {
    apiGet<EmbeddingScene>("/api/app/embedding-scene")
      .then(setScene)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed to load"));
  }, []);

  // Deviation from the plan's useRef(PanResponder.create(...)).current +
  // orbit-mirroring ref: both read/write refs during render, which the
  // react-hooks/refs lint rule rejects. A memoized responder with a functional
  // setOrbit update is equivalent and needs no ref at all.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) + Math.abs(g.dy) > 8,
        onPanResponderMove: (_e, g) => {
          setOrbit(({ yaw, pitch }) => ({
            yaw: yaw + g.vx * 0.05,
            pitch: Math.min(1.4, Math.max(-1.4, pitch + g.vy * 0.05)),
          }));
        },
      }),
    []
  );

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
  return <LoadedSpace scene={scene} orbit={orbit} panHandlers={pan.panHandlers} onOpenPost={(slug) => router.push(`/post/${slug}`)} />;
}

function LoadedSpace({
  scene,
  orbit,
  panHandlers,
  onOpenPost,
}: {
  scene: EmbeddingScene;
  orbit: { yaw: number; pitch: number };
  panHandlers: object;
  onOpenPost: (slug: string) => void;
}) {
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
    <View style={styles.root} {...panHandlers}>
      <Canvas camera={{ fov: 50 }}>
        <OrbitRig yaw={orbit.yaw} pitch={orbit.pitch} />
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
