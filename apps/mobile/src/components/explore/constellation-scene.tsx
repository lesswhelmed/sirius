/* eslint-disable react/no-unknown-property -- R3F three-element props (args, attach, position, side, ...) are not DOM attributes */
// The Explore mode's 3D hero: an editorial "constellation" rendered in the
// Sirius paper-and-ink palette (NOT the web Observatory's neon spheres). It is a
// mobile-only scene on purpose — the shared @repo/embedding-scene SpaceScene uses
// type-only fiber imports so it can't host the per-frame pulse, and recoloring it
// would risk the web look. This file imports the native fiber runtime directly,
// so it can drive its own camera rig + focus pulse.
//
// Camera "flies to" the focused node: the rig eases both the orbit (yaw/pitch
// from drag) AND a look-at center toward the focused node's position every
// frame, then does the mandatory synchronous expo-gl flush (see CameraRig).

import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useFrame } from "@react-three/fiber/native";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";
import { BackSide, type Mesh } from "three";
import { Sirius } from "@/constants/theme";

type Vec3 = [number, number, number];

// Editorial palette — ink dots on paper, oxblood for the one focused node.
const PAPER = Sirius.color.paper;
const INK = Sirius.color.ink;
const INK_FAINT = Sirius.color.inkFaint;
const OXBLOOD = Sirius.color.accent;

// Camera framing distance from the focused node. Small enough to feel "zoomed
// in" on it, wide enough that its neighbors stay in frame. This is the *neutral*
// distance (zoom === 1); pinch scales it live between ZOOM_MIN..ZOOM_MAX.
const FRAME_RADIUS = 9;
const DAMPING = 0.16; // orbit + center + radius easing per frame (OrbitControls feel)

// Pinch multiplier bounds on FRAME_RADIUS. <1 = closer (zoomed in), >1 = farther
// out. ~3x each way keeps a single node legible without losing the whole map.
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
// Two-finger pan: NDC-delta → world units, scaled by the live radius so a drag
// moves the same on-screen distance whether zoomed in or out.
const PAN_SCALE = 0.9;

interface Orbit {
  yaw: number;
  pitch: number;
}

// All edges of one visual weight, as a single line-segment geometry. `onlyFocus`
// renders just the edges incident to the focused node (drawn in oxblood on top);
// otherwise renders the faint taxonomy backbone.
function EdgeLines({
  scene,
  focusedId,
  onlyFocus,
}: {
  scene: EmbeddingScene;
  focusedId: string | null;
  onlyFocus: boolean;
}) {
  // Build positions as a plain Float32Array and declare the geometry in JSX
  // (rather than constructing BufferGeometry + passing it as a prop) — that
  // sidesteps the dual-@types/three identity mismatch inside apps/mobile. Keyed
  // so the attribute rebuilds when the edge set changes (focus moves).
  const positions = useMemo(() => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n.position]));
    const verts: number[] = [];
    for (const e of scene.edges) {
      const incident = e.from === focusedId || e.to === focusedId;
      if (onlyFocus ? !incident : e.kind !== "taxonomy") continue;
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      verts.push(...a, ...b);
    }
    return new Float32Array(verts);
  }, [scene, focusedId, onlyFocus]);
  return (
    <lineSegments key={`${onlyFocus}:${focusedId}:${positions.length}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={onlyFocus ? OXBLOOD : INK}
        transparent
        opacity={onlyFocus ? 0.5 : 0.14}
      />
    </lineSegments>
  );
}

// Invisible larger hit halo + a visible dot. Focused = oxblood (the pulse halo
// is a separate mesh below); neighbors = ink; everything else fades to faint.
const HIT_FACTOR = 3.5;
const HIT_MIN = 0.5;
function NodeDot({
  node,
  focused,
  neighbor,
  dim,
  onPick,
}: {
  node: SceneNode;
  focused: boolean;
  neighbor: boolean;
  dim: boolean;
  onPick: (node: SceneNode) => void;
}) {
  const base = node.kind === "post" ? 0.08 : 0.13;
  const radius = focused ? base * 1.9 : base;
  const color = focused ? OXBLOOD : neighbor ? INK : INK_FAINT;
  return (
    <group position={node.position}>
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onPick(node);
        }}
      >
        <sphereGeometry args={[Math.max(radius * HIT_FACTOR, HIT_MIN), 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={focused ? 1 : neighbor ? 0.85 : dim ? 0.3 : 0.55}
        />
      </mesh>
    </group>
  );
}

// Oxblood glow that breathes around the focused node. Lives at a stable ref so
// changing focus only moves its position prop — the animation never restarts.
function PulseHalo({ position }: { position: Vec3 }) {
  const ref = useRef<Mesh>(null);
  const t = useRef(0);
  useFrame((_state, delta) => {
    t.current += delta;
    const m = ref.current;
    if (!m) return;
    const s = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t.current * 2.2));
    m.scale.setScalar(s);
    const mat = m.material as { opacity?: number };
    if (mat)
      mat.opacity = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(t.current * 2.2));
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.4, 16, 16]} />
      <meshBasicMaterial
        color={OXBLOOD}
        transparent
        opacity={0.22}
        depthWrite={false}
      />
    </mesh>
  );
}

// Drag surface for orbit + pinch-zoom + two-finger pan. The Canvas claims every
// touch before any RN responder on an ancestor can, so ALL gestures must live
// INSIDE the R3F event system (an ancestor GestureDetector never sees these
// touches): an inside-out sphere catches drags that miss every node; node halos
// still win the raycast (nearer hit). Builds on app/space.tsx's orbit approach.
//
// Multi-touch: we track each live pointer by its pointerId in NDC ([-1,1]). One
// pointer → orbit (yaw/pitch delta). Two pointers → pinch (their distance ratio
// scales zoom) + pan (their midpoint delta moves the look-at center). Transitions
// reset the pinch baseline so finger lifts don't snap the camera.
function OrbitBackdrop({
  onOrbit,
  onZoom,
  onPan,
}: {
  onOrbit: (dx: number, dy: number) => void;
  onZoom: (factor: number) => void;
  onPan: (dx: number, dy: number) => void;
}) {
  const pts = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDist = useRef<number | null>(null);
  const pinchMid = useRef<{ x: number; y: number } | null>(null);
  const resetPinch = () => {
    pinchDist.current = null;
    pinchMid.current = null;
  };
  return (
    <mesh
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        pts.current.set(e.pointerId, { x: e.pointer.x, y: e.pointer.y });
        resetPinch();
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        const map = pts.current;
        const prev = map.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.pointer.x, y: e.pointer.y };
        map.set(e.pointerId, cur);
        if (map.size === 1) {
          onOrbit(cur.x - prev.x, cur.y - prev.y);
          return;
        }
        // Two (or more) fingers: pinch + pan off the first two live pointers.
        const [a, b] = [...map.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchDist.current != null && dist > 0) {
          // Fingers apart → dist grows → factor < 1 → smaller radius → zoom in.
          onZoom(pinchDist.current / dist);
          if (pinchMid.current) {
            onPan(mid.x - pinchMid.current.x, mid.y - pinchMid.current.y);
          }
        }
        pinchDist.current = dist;
        pinchMid.current = mid;
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        pts.current.delete(e.pointerId);
        resetPinch();
      }}
      onPointerLeave={(e: ThreeEvent<PointerEvent>) => {
        pts.current.delete(e.pointerId);
        resetPinch();
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

// The single priority-1 useFrame subscriber (priority > 0 = we own rendering).
// Each frame: ease the orbit toward the drag target, ease the look-at center
// toward the focused node (plus any pan offset), ease the radius toward
// FRAME_RADIUS * zoom, place the camera on the orbit sphere around that center,
// render, then force the synchronous GL round-trip expo-gl needs or the view
// freezes on the last frame / stays black (see app/space.tsx:80-83).
function CameraRig({
  orbit,
  center,
  pan,
  zoom,
}: {
  orbit: RefObject<Orbit>;
  center: RefObject<Vec3>;
  pan: RefObject<Vec3>;
  zoom: RefObject<number>;
}) {
  const curOrbit = useRef<Orbit>({ ...orbit.current });
  const curCenter = useRef<Vec3>([...center.current] as Vec3);
  const curRadius = useRef<number>(FRAME_RADIUS * zoom.current);
  useFrame((state) => {
    const o = curOrbit.current;
    o.yaw += (orbit.current.yaw - o.yaw) * DAMPING;
    o.pitch += (orbit.current.pitch - o.pitch) * DAMPING;
    const c = curCenter.current;
    for (let i = 0; i < 3; i++) {
      c[i] += (center.current[i]! + pan.current[i]! - c[i]!) * DAMPING;
    }
    curRadius.current +=
      (FRAME_RADIUS * zoom.current - curRadius.current) * DAMPING;
    const r = curRadius.current;
    state.camera.position.set(
      c[0]! + r * Math.cos(o.pitch) * Math.sin(o.yaw),
      c[1]! + r * Math.sin(o.pitch),
      c[2]! + r * Math.cos(o.pitch) * Math.cos(o.yaw),
    );
    state.camera.lookAt(c[0]!, c[1]!, c[2]!);
    // fiber/native patches gl.render to also call endFrameEXP
    state.gl.render(state.scene, state.camera);
    state.gl.getContext().getError();
  }, 1);
  return null;
}

export interface ConstellationHeroProps {
  scene: EmbeddingScene;
  focused: SceneNode | null;
  neighborIds: Set<string>;
  // A node was tapped in the 3D map (host refocuses categories / opens posts).
  onPickNode: (node: SceneNode) => void;
  style?: StyleProp<ViewStyle>;
}

// Self-contained 3D hero. Mount it at a fixed height; it fills its container.
export function ConstellationHero({
  scene,
  focused,
  neighborIds,
  onPickNode,
  style,
}: ConstellationHeroProps) {
  const orbit = useRef<Orbit>({ yaw: 0.6, pitch: 0.32 });
  // Live pinch multiplier on FRAME_RADIUS (kept across focus changes so the
  // user's chosen zoom level survives drilling to a new node).
  const zoom = useRef<number>(1);
  // The focused node's position, eased toward by the camera each frame. Updated
  // in an effect (not during render) so the rig's useFrame reads the latest.
  const center = useRef<Vec3>(focused?.position ?? [0, 0, 0]);
  // Accumulated two-finger pan offset, added on top of `center`. Reset whenever
  // focus moves so each newly-focused node recenters in frame.
  const pan = useRef<Vec3>([0, 0, 0]);
  useEffect(() => {
    if (focused) {
      center.current = focused.position;
      pan.current = [0, 0, 0];
    }
  }, [focused]);

  const onOrbitDelta = (dx: number, dy: number) => {
    const t = orbit.current;
    t.yaw -= dx * 2.5;
    t.pitch = Math.min(1.4, Math.max(-1.4, t.pitch - dy * 2));
  };

  const onZoom = (factor: number) => {
    zoom.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.current * factor));
  };

  // Map a screen-space (NDC) midpoint delta to a world pan in the camera's
  // horizontal plane. Right vector for the current yaw is (-cos, 0, sin); we
  // move the center opposite the drag so content tracks the fingers. Vertical
  // drag pans along world up. Scaled by the live radius for consistent feel.
  const onPan = (dx: number, dy: number) => {
    const yaw = orbit.current.yaw;
    const k = PAN_SCALE * FRAME_RADIUS * zoom.current;
    const rightX = -Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    const p = pan.current;
    p[0] = p[0]! - rightX * dx * k;
    p[1] = p[1]! + dy * k;
    p[2] = p[2]! - rightZ * dx * k;
  };

  const focusedId = focused?.id ?? null;
  return (
    <View style={[styles.hero, style]}>
      <Canvas camera={{ fov: 52 }}>
        <color attach="background" args={[PAPER]} />
        <CameraRig orbit={orbit} center={center} pan={pan} zoom={zoom} />
        <OrbitBackdrop onOrbit={onOrbitDelta} onZoom={onZoom} onPan={onPan} />
        <ambientLight intensity={1} />
        <EdgeLines scene={scene} focusedId={focusedId} onlyFocus={false} />
        <EdgeLines scene={scene} focusedId={focusedId} onlyFocus />
        {scene.nodes.map((node) => (
          <NodeDot
            key={node.id}
            node={node}
            focused={node.id === focusedId}
            neighbor={neighborIds.has(node.id)}
            dim={focusedId != null && !neighborIds.has(node.id)}
            onPick={onPickNode}
          />
        ))}
        {focused ? <PulseHalo position={focused.position} /> : null}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: PAPER, overflow: "hidden" },
});
