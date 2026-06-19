/* eslint-disable react/no-unknown-property -- R3F three-element props (args, side, attach, ...) are not DOM attributes */
// 3D embedding space. Same SpaceScene + selection hook as web; native host
// differs only in Canvas import, camera control (pan-to-orbit), and overlay.

import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useFrame } from "@react-three/fiber/native";
import { SpaceScene } from "@repo/embedding-scene/react/space-scene";
import { useSceneSelection } from "@repo/embedding-scene/react/use-scene-selection";
import type { EmbeddingScene } from "@repo/embedding-scene/types";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BackSide } from "three";

// Share the Tree tab's scene query — SAME key + fetcher, so opening one screen
// warms the other within staleTime (no duplicate fetch) and Tree's
// pull-to-refresh refreshes this screen too.
import { fetchScene, SCENE_QUERY_KEY } from "./(tabs)/tree";

interface Orbit {
	yaw: number;
	pitch: number;
}

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
			<meshBasicMaterial
				side={BackSide}
				transparent
				opacity={0}
				depthWrite={false}
			/>
		</mesh>
	);
}

// Camera rig + native frame pump, the single priority-1 useFrame subscriber
// (priority > 0 tells fiber we own rendering). Each frame it eases the camera
// toward the gesture target (OrbitControls-style damping; the target lives in
// a ref so dragging never re-renders React), renders, then forces a
// synchronous GL round-trip: expo-gl silently drops presented frames unless
// something synchronous flushes its command queue each frame — without the
// getError() the screen freezes on the last flushed frame (or stays black).
// Camera note: `<perspectiveCamera makeDefault>` is a drei prop, not raw R3F
// (no drei on native), so we drive the canvas default camera instead.
const ORBIT_RADIUS = 18;
const ORBIT_DAMPING = 0.18;
function CameraRig({ target }: { target: RefObject<Orbit> }) {
	const current = useRef<Orbit>({ ...target.current });
	useFrame((state) => {
		const cur = current.current;
		cur.yaw += (target.current.yaw - cur.yaw) * ORBIT_DAMPING;
		cur.pitch += (target.current.pitch - cur.pitch) * ORBIT_DAMPING;
		state.camera.position.set(
			ORBIT_RADIUS * Math.cos(cur.pitch) * Math.sin(cur.yaw),
			ORBIT_RADIUS * Math.sin(cur.pitch),
			ORBIT_RADIUS * Math.cos(cur.pitch) * Math.cos(cur.yaw),
		);
		state.camera.lookAt(0, 0, 0);
		// fiber/native patches gl.render to also call endFrameEXP
		state.gl.render(state.scene, state.camera);
		state.gl.getContext().getError();
	}, 1);
	return null;
}

export default function SpaceScreen() {
	const router = useRouter();
	const {
		data: scene,
		isLoading,
		error,
	} = useQuery({
		queryKey: SCENE_QUERY_KEY,
		queryFn: fetchScene,
	});

	// Hook needs a scene; render gate first.
	if (error) {
		return (
			<View style={styles.center}>
				<Text style={styles.error}>
					{error instanceof Error ? error.message : "failed to load"}
				</Text>
			</View>
		);
	}
	if (isLoading || !scene) {
		return (
			<View style={styles.center}>
				<Text style={styles.muted}>Loading space…</Text>
			</View>
		);
	}
	return (
		<LoadedSpace
			scene={scene}
			onOpenPost={(slug) => router.push(`/post/${slug}`)}
		/>
	);
}

function LoadedSpace({
	scene,
	onOpenPost,
}: {
	scene: EmbeddingScene;
	onOpenPost: (slug: string) => void;
}) {
	const orbitTarget = useRef<Orbit>({ yaw: 0.6, pitch: 0.35 });
	const onOrbitDelta = useCallback((dx: number, dy: number) => {
		// deltas arrive in NDC units (-1..1 across the canvas); ~2.5 rad per
		// full-width drag feels right for a thumb.
		const t = orbitTarget.current;
		t.yaw -= dx * 2.5;
		t.pitch = Math.min(1.4, Math.max(-1.4, t.pitch - dy * 2));
	}, []);
	const {
		selected,
		select,
		neighborIds,
		drilled,
		drilledEntries,
		drill,
		closeDrill,
	} = useSceneSelection(scene);
	const openSelected = useCallback(() => {
		if (selected?.slug) onOpenPost(selected.slug);
	}, [selected, onOpenPost]);
	return (
		<View style={styles.root}>
			<Canvas camera={{ fov: 50 }}>
				{/* Web leaves the canvas transparent over the page; expo-gl doesn't
            composite a transparent clear, so clear to the screen bg instead. */}
				<color attach="background" args={["#0b0b0f"]} />
				<CameraRig target={orbitTarget} />
				<OrbitBackdrop onDelta={onOrbitDelta} />
				<SpaceScene
					scene={scene}
					selectedId={selected?.id ?? null}
					neighborIds={neighborIds}
					onSelect={select}
					onDrill={drill}
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
						{selected.kind !== "post" && drilled?.id !== selected.id ? (
							<Pressable onPress={() => drill(selected.id)}>
								<Text style={styles.link}>tap again for the index</Text>
							</Pressable>
						) : null}
					</View>
					{drilled?.id === selected.id ? (
						<View style={styles.index}>
							<View style={styles.indexHeader}>
								<Text style={styles.kind}>
									Index · {drilledEntries.length}{" "}
									{drilledEntries.length === 1 ? "entry" : "entries"}
								</Text>
								<Pressable onPress={closeDrill} hitSlop={8}>
									<Text style={styles.indexClose}>✕</Text>
								</Pressable>
							</View>
							<ScrollView style={styles.indexList}>
								{drilledEntries.length === 0 ? (
									<Text style={styles.muted}>Nothing filed here yet.</Text>
								) : (
									drilledEntries.map((entry, idx) => (
										<View key={entry.node.id} style={styles.indexRow}>
											<Text style={styles.indexNum}>
												{String(idx + 1).padStart(2, "0")}
											</Text>
											{/* like web: label locates the post in space… */}
											<Pressable
												style={styles.indexLabelHit}
												onPress={() => select(entry.node.id)}
											>
												<Text style={styles.indexLabel} numberOfLines={1}>
													{entry.node.label}
												</Text>
											</Pressable>
											{entry.weight != null ? (
												<Text style={styles.indexScore}>
													{entry.weight.toFixed(2)}
												</Text>
											) : null}
											{/* …and a separate affordance opens it */}
											{entry.node.slug ? (
												<Pressable
													hitSlop={6}
													onPress={() => {
														if (entry.node.slug) onOpenPost(entry.node.slug);
													}}
												>
													<Text style={styles.indexOpen}>open →</Text>
												</Pressable>
											) : null}
										</View>
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
	indexHeader: {
		alignItems: "baseline",
		flexDirection: "row",
		justifyContent: "space-between",
	},
	indexClose: { color: "#888", fontSize: 13 },
	indexList: { maxHeight: 220, marginTop: 4 },
	indexRow: {
		alignItems: "baseline",
		flexDirection: "row",
		gap: 8,
		paddingVertical: 6,
	},
	indexNum: { color: "#777", fontSize: 10, fontVariant: ["tabular-nums"] },
	indexLabelHit: { flex: 1 },
	indexLabel: { color: "#ddd", fontSize: 14 },
	indexScore: { color: "#7da", fontSize: 10 },
	indexOpen: {
		color: "#9bd",
		fontSize: 11,
		textDecorationLine: "underline",
	},
});
