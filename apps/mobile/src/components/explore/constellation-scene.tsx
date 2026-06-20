/* eslint-disable react/no-unknown-property -- R3F three-element props (args, attach, position, side, ...) are not DOM attributes */
// The Explore mode's 3D hero: an editorial "constellation" rendered in the
// Sirius paper-and-ink palette (NOT the web Observatory's neon spheres). It is a
// mobile-only scene on purpose — the shared @repo/embedding-scene SpaceScene uses
// type-only fiber imports so it can't host the per-frame pulse, and recoloring it
// would risk the web look. This file imports the native fiber runtime directly,
// so it can drive its own camera rig + focus pulse + projected labels.
//
// CAMERA: free-but-bounded. The rig orbits a single eased look-at `target` that
// the USER controls (one-finger orbit, pinch zoom, two-finger pan — all bounded
// to the scene's extent). Selecting a node gently flies the target to it without
// locking (the next gesture just overrides it). First load frames the whole map.
//
// LABELS: rendered as an RN overlay (no 3D text lib on mobile). A priority-2
// useFrame projects each labeled node's world position to screen space into a
// Reanimated shared value; absolutely-positioned <Text> reads it on the UI
// thread — zero per-frame React re-render, and the single GL flush stays in
// CameraRig.

import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useFrame } from "@react-three/fiber/native";
import type { EmbeddingScene, SceneNode } from "@repo/embedding-scene/types";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import { BackSide, type Camera, type Mesh, Vector3 } from "three";
import { Sirius } from "@/constants/theme";

type Vec3 = [number, number, number];

// Editorial palette — ink dots on paper, oxblood for the one focused node.
const PAPER = Sirius.color.paper;
const INK = Sirius.color.ink;
const INK_MUTED = Sirius.color.inkMuted;
const INK_FAINT = Sirius.color.inkFaint;
const OXBLOOD = Sirius.color.accent;
const MARK = Sirius.color.mark;

const DAMPING = 0.16; // orbit + target + radius easing per frame (OrbitControls feel)

// Camera framing, all DERIVED from the scene's own extent (radius R) so any map
// — tiny or sprawling — is framed sensibly. FIT_MULT*R is the zoom=1 distance
// that frames the whole sphere (~17% margin at fov 52). Pinch scales it live.
const FIT_MULT = 2.4;
const ZOOM_MIN = 0.18; // closest: lean in on a single node
const ZOOM_MAX = 1.15; // farthest: never pull back past the whole-scene fit
const PAN_LIMIT_MULT = 1.1; // look-at target may stray at most R*1.1 from center
const PAN_SCALE = 0.9; // NDC-delta → world units (scaled by live radius)
const FRAME_ZOOM = 0.3; // zoom the explicit "Frame" action leans to

// Label overlay geometry: each label box is centered on its node's projected
// point and lifted above the dot.
const LABEL_W = 144;
const LABEL_OFFSET_Y = 22;
const MAX_CATEGORY_LABELS = 14; // past this, only focus + neighbors + parent

// Gesture instrumentation for the ONE path we can't statically prove: that
// react-three-fiber/native actually delivers two simultaneous pointers (with
// distinct pointerIds) through the expo-gl GLView — the prerequisite for pinch.
// Dev-only, logged on gesture TRANSITIONS only (down / pinch-begin / up).
const logGesture = (...args: unknown[]) => {
  if (__DEV__) console.log("[constellation]", ...args);
};

interface Orbit {
  yaw: number;
  pitch: number;
}

interface Bounds {
  center: Vec3;
  radius: number;
}

// Axis-aligned center + bounding radius over all node positions. Floors the
// radius so a single-node / degenerate scene still frames sanely.
function computeBounds(nodes: SceneNode[]): Bounds {
  if (nodes.length === 0) return { center: [0, 0, 0], radius: 3 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    const [x, y, z] = n.position;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let r = 0;
  for (const n of nodes) {
    const dx = n.position[0] - center[0];
    const dy = n.position[1] - center[1];
    const dz = n.position[2] - center[2];
    const d = Math.hypot(dx, dy, dz);
    if (d > r) r = d;
  }
  return { center, radius: Math.max(r, 2) };
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

// A faint wireframe globe marking the map's confines. One static low-seg sphere
// at the scene center — reads like a drafting/armillary outline, not a neon dome.
// Wireframe MATERIAL (not edgesGeometry) sidesteps this file's dual-@types/three
// geometry-instance quirk.
function SceneBoundary({ center, radius }: Bounds) {
  return (
    <mesh position={center}>
      <sphereGeometry args={[radius * 1.05, 16, 12]} />
      <meshBasicMaterial
        color={INK_FAINT}
        wireframe
        transparent
        opacity={0.1}
        depthWrite={false}
      />
    </mesh>
  );
}

// Invisible larger hit halo + a visible dot + (for the selected post) an oxblood
// ring. Every node — category, post, project — carries a full-size halo so even
// dimmed/slug-less posts stay tappable. Single tap selects; double tap frames.
const HIT_FACTOR = 3.5;
const HIT_MIN = 0.55;
const KIND_BASE: Record<string, number> = {
  category: 0.13,
  post: 0.075,
  project: 0.11,
};
const DOUBLE_TAP_MS = 300;

function NodeDot({
  node,
  focused,
  neighbor,
  inSubtree,
  selected,
  onPick,
  onFrame,
}: {
  node: SceneNode;
  focused: boolean;
  neighbor: boolean;
  inSubtree: boolean;
  selected: boolean;
  onPick: (node: SceneNode) => void;
  onFrame: (node: SceneNode) => void;
}) {
  const lastTap = useRef(0);
  const base = KIND_BASE[node.kind] ?? 0.1;
  const radius = focused ? base * 1.9 : neighbor ? base * 1.15 : base;

  let color: string = INK_FAINT;
  if (focused) color = OXBLOOD;
  else if (neighbor) color = INK;
  else if (node.kind === "project") color = MARK;
  else if (node.kind === "post") color = inSubtree ? INK : INK_MUTED;

  let opacity = Math.max(0.45, base); // floor so nothing ever "blacks out"
  if (focused) opacity = 1;
  else if (neighbor) opacity = 0.9;
  else if (inSubtree) opacity = 0.7;

  return (
    <group position={node.position}>
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const now = Date.now();
          if (now - lastTap.current < DOUBLE_TAP_MS) onFrame(node);
          else onPick(node);
          lastTap.current = now;
        }}
      >
        <sphereGeometry args={[Math.max(radius * HIT_FACTOR, HIT_MIN), 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      {selected && !focused ? (
        <mesh>
          <sphereGeometry args={[radius * 2.2, 16, 16]} />
          <meshBasicMaterial
            color={OXBLOOD}
            wireframe
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </mesh>
      ) : null}
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
// INSIDE the R3F event system: an inside-out sphere catches drags that miss
// every node; node halos still win the raycast (nearer hit).
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
        logGesture("down", "id=", e.pointerId, "active=", pts.current.size);
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
        const [a, b] = [...map.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchDist.current != null && dist > 0) {
          onZoom(pinchDist.current / dist);
          if (pinchMid.current) {
            onPan(mid.x - pinchMid.current.x, mid.y - pinchMid.current.y);
          }
        } else {
          logGesture(
            "pinch:begin",
            "active=",
            map.size,
            "ids=",
            [...map.keys()].join(","),
            "dist=",
            dist.toFixed(3),
          );
        }
        pinchDist.current = dist;
        pinchMid.current = mid;
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        pts.current.delete(e.pointerId);
        resetPinch();
        logGesture("up", "id=", e.pointerId, "active=", pts.current.size);
      }}
      onPointerLeave={(e: ThreeEvent<PointerEvent>) => {
        pts.current.delete(e.pointerId);
        resetPinch();
      }}
    >
      <sphereGeometry args={[120, 8, 8]} />
      <meshBasicMaterial
        side={BackSide}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

// The single priority-1 useFrame subscriber that OWNS rendering (priority > 0 =
// we take over the loop). Each frame: ease orbit toward the drag target, ease
// the look-at center toward `target`, ease radius toward fitRadius * zoom, place
// the camera on the orbit sphere around that center, render, then force the
// synchronous GL round-trip expo-gl needs or the view freezes / stays black.
function CameraRig({
  orbit,
  target,
  zoom,
  fitRadius,
  initialTarget,
}: {
  orbit: RefObject<Orbit>;
  target: RefObject<Vec3>;
  zoom: RefObject<number>;
  fitRadius: number;
  initialTarget: Vec3;
}) {
  const curOrbit = useRef<Orbit>({ ...orbit.current });
  const curTarget = useRef<Vec3>([...initialTarget] as Vec3);
  const curRadius = useRef<number>(fitRadius * zoom.current);
  useFrame((state) => {
    const o = curOrbit.current;
    o.yaw += (orbit.current.yaw - o.yaw) * DAMPING;
    o.pitch += (orbit.current.pitch - o.pitch) * DAMPING;
    const c = curTarget.current;
    for (let i = 0; i < 3; i++) {
      c[i] += (target.current[i]! - c[i]!) * DAMPING;
    }
    curRadius.current += (fitRadius * zoom.current - curRadius.current) * DAMPING;
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

export interface ProjectedLabel {
  x: number;
  y: number;
  o: number;
}

// Writing a Reanimated shared value is a legitimate JS→UI-thread side effect.
// Funnel it through a helper so the React Compiler's immutability check (which
// freezes the prop where the projector receives it) doesn't flag the assignment.
function writeShared<T>(sv: SharedValue<T>, value: T) {
  sv.value = value;
}

// Priority-2 useFrame (runs AFTER CameraRig rendered, so camera matrices are
// fresh). Projects each labeled node to screen px + a distance/clip opacity and
// writes the map into a shared value. NEVER calls gl.render — CameraRig stays the
// only renderer. No React state per frame.
function LabelProjector({
  nodes,
  projected,
  fitRadius,
}: {
  nodes: SceneNode[];
  projected: SharedValue<Record<string, ProjectedLabel>>;
  fitRadius: number;
}) {
  const v = useRef(new Vector3());
  const lastCam = useRef<Vec3>([Infinity, 0, 0]);
  useFrame((state) => {
    const cam = state.camera;
    // Skip the (expensive-ish) shared-value write when the camera is at rest.
    const moved =
      Math.abs(cam.position.x - lastCam.current[0]) +
        Math.abs(cam.position.y - lastCam.current[1]) +
        Math.abs(cam.position.z - lastCam.current[2]) >
      0.0006;
    if (!moved) return;
    lastCam.current = [cam.position.x, cam.position.y, cam.position.z];

    const w = state.size?.width ?? 0;
    const h = state.size?.height ?? 0;
    const near = fitRadius * 0.5;
    const far = fitRadius * 1.9;
    const out: Record<string, ProjectedLabel> = {};
    for (const n of nodes) {
      const dx = n.position[0] - cam.position.x;
      const dy = n.position[1] - cam.position.y;
      const dz = n.position[2] - cam.position.z;
      const dist = Math.hypot(dx, dy, dz);
      v.current.set(n.position[0], n.position[1], n.position[2]);
      // Dual-@types/three identity mismatch (root vs apps/mobile) — cast the
      // fiber camera to this package's three Camera type for .project().
      v.current.project(cam as unknown as Camera);
      let o = 0;
      if (v.current.z <= 1) {
        o = 1 - (dist - near) / (far - near);
        o = Math.max(0, Math.min(1, o));
      }
      out[n.id] = {
        x: (v.current.x * 0.5 + 0.5) * w,
        y: (-v.current.y * 0.5 + 0.5) * h,
        o,
      };
    }
    writeShared(projected, out);
  }, 2);
  return null;
}

// One RN overlay label, positioned + faded purely on the UI thread from the
// shared projection map. pointerEvents none so it never steals orbit gestures.
function NodeLabel({
  node,
  projected,
  focused,
}: {
  node: SceneNode;
  projected: SharedValue<Record<string, ProjectedLabel>>;
  focused: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const p = projected.value[node.id];
    if (!p) return { opacity: 0, transform: [{ translateX: -9999 }] };
    return {
      opacity: p.o,
      transform: [
        { translateX: p.x - LABEL_W / 2 },
        { translateY: p.y - LABEL_OFFSET_Y },
      ],
    };
  });
  const isPost = node.kind === "post";
  const isProject = node.kind === "project";
  return (
    <Animated.View style={[styles.labelWrap, style]} pointerEvents="none">
      {isPost ? (
        <View style={styles.labelChip}>
          <Text style={styles.labelPost} numberOfLines={1}>
            {node.label}
          </Text>
        </View>
      ) : (
        <Text
          style={[
            isProject ? styles.labelProject : styles.labelCat,
            focused && styles.labelFocused,
          ]}
          numberOfLines={1}
        >
          {node.label}
        </Text>
      )}
    </Animated.View>
  );
}

export interface ConstellationHeroProps {
  scene: EmbeddingScene;
  focused: SceneNode | null;
  neighborIds: Set<string>;
  subtreePostIds: Set<string>;
  // The tapped/preview node — gets the oxblood ring + a label, and is what the
  // camera gently flies toward (falls back to `focused`).
  selectedNode: SceneNode | null;
  // A node was tapped in the 3D map (host selects categories / previews posts).
  onPickNode: (node: SceneNode) => void;
  // Bumped by the host's "Frame" button to lean the camera in on the current
  // look-at node.
  frameTick: number;
  style?: StyleProp<ViewStyle>;
}

// Self-contained 3D hero. Mount it at a fixed height; it fills its container.
export function ConstellationHero({
  scene,
  focused,
  neighborIds,
  subtreePostIds,
  selectedNode,
  onPickNode,
  frameTick,
  style,
}: ConstellationHeroProps) {
  const bounds = useMemo(() => computeBounds(scene.nodes), [scene.nodes]);
  const fitRadius = bounds.radius * FIT_MULT;
  const panLimit = bounds.radius * PAN_LIMIT_MULT;

  const orbit = useRef<Orbit>({ yaw: 0.6, pitch: 0.32 });
  // Live pinch multiplier on fitRadius, kept across selection so the user's zoom
  // survives flying to a new node.
  const zoom = useRef<number>(1);
  // The eased look-at point. Init at scene center (whole-map fit); moved only by
  // the user's pan and by gentle fly-to — never hard-snapped on selection.
  const target = useRef<Vec3>([...bounds.center]);

  // One-time whole-scene framing.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    target.current = [...bounds.center];
    zoom.current = 1;
  }, [bounds]);

  // The node the camera should be looking at: the explicit selection, else the
  // focused category.
  const lookAtNode = selectedNode ?? focused;
  const lookAtId = lookAtNode?.id ?? null;

  // Gentle fly-to whenever the look-at node changes — keeps zoom, no pan reset,
  // and is interruptible (the next pan/orbit just overrides `target`). The first
  // value is swallowed so the initial focus never overrides the whole-map fit.
  const prevLookId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevLookId.current === undefined) {
      prevLookId.current = lookAtId;
      return;
    }
    if (lookAtId == null || lookAtId === prevLookId.current) return;
    prevLookId.current = lookAtId;
    if (lookAtNode) target.current = [...lookAtNode.position];
  }, [lookAtId, lookAtNode]);

  // Explicit "Frame" — fly in close on the current look-at node.
  const frameNode = useCallback((node: SceneNode) => {
    target.current = [...node.position];
    zoom.current = Math.max(ZOOM_MIN, FRAME_ZOOM);
  }, []);
  const prevTick = useRef(frameTick);
  useEffect(() => {
    if (frameTick === prevTick.current) return;
    prevTick.current = frameTick;
    if (lookAtNode) frameNode(lookAtNode);
  }, [frameTick, lookAtNode, frameNode]);

  useEffect(() => {
    logGesture(
      "scene",
      "nodes=",
      scene.nodes.length,
      "edges=",
      scene.edges.length,
      "R=",
      bounds.radius.toFixed(2),
    );
  }, [scene, bounds]);

  const onOrbitDelta = (dx: number, dy: number) => {
    const t = orbit.current;
    t.yaw -= dx * 2.5;
    t.pitch = Math.min(1.4, Math.max(-1.4, t.pitch - dy * 2));
  };

  const onZoom = (factor: number) => {
    zoom.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.current * factor));
  };

  // Map a screen-space (NDC) midpoint delta to a world pan in the camera's
  // horizontal plane, then clamp the resulting look-at within R*1.1 of center so
  // the camera can never fly off into the void.
  const onPan = (dx: number, dy: number) => {
    const yaw = orbit.current.yaw;
    const k = PAN_SCALE * fitRadius * zoom.current;
    const rightX = -Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    const t = target.current;
    let nx = t[0]! - rightX * dx * k;
    let ny = t[1]! + dy * k;
    let nz = t[2]! - rightZ * dx * k;
    const ox = nx - bounds.center[0];
    const oy = ny - bounds.center[1];
    const oz = nz - bounds.center[2];
    const len = Math.hypot(ox, oy, oz);
    if (len > panLimit) {
      const s = panLimit / len;
      nx = bounds.center[0] + ox * s;
      ny = bounds.center[1] + oy * s;
      nz = bounds.center[2] + oz * s;
    }
    target.current = [nx, ny, nz];
  };

  const focusedId = focused?.id ?? null;
  const selectedId = selectedNode?.id ?? null;

  // Which nodes get an overlay label: all categories/projects (capped so a huge
  // taxonomy doesn't clutter — then we keep focus + neighbors + parent), plus
  // the currently selected post.
  const projected = useSharedValue<Record<string, ProjectedLabel>>({});
  const labelNodes = useMemo(() => {
    const structural = scene.nodes.filter((n) => n.kind !== "post");
    let kept = structural;
    if (structural.length > MAX_CATEGORY_LABELS) {
      kept = structural.filter(
        (n) => n.id === focusedId || neighborIds.has(n.id),
      );
    }
    if (selectedNode?.kind === "post") kept = [...kept, selectedNode];
    return kept;
  }, [scene.nodes, focusedId, neighborIds, selectedNode]);

  return (
    <View style={[styles.hero, style]}>
      <Canvas camera={{ fov: 52 }}>
        <color attach="background" args={[PAPER]} />
        <CameraRig
          orbit={orbit}
          target={target}
          zoom={zoom}
          fitRadius={fitRadius}
          initialTarget={bounds.center}
        />
        <LabelProjector
          nodes={labelNodes}
          projected={projected}
          fitRadius={fitRadius}
        />
        <OrbitBackdrop onOrbit={onOrbitDelta} onZoom={onZoom} onPan={onPan} />
        <ambientLight intensity={1} />
        <SceneBoundary center={bounds.center} radius={bounds.radius} />
        <EdgeLines scene={scene} focusedId={focusedId} onlyFocus={false} />
        <EdgeLines scene={scene} focusedId={focusedId} onlyFocus />
        {scene.nodes.map((node) => (
          <NodeDot
            key={node.id}
            node={node}
            focused={node.id === focusedId}
            neighbor={neighborIds.has(node.id)}
            inSubtree={node.kind === "post" && subtreePostIds.has(node.id)}
            selected={node.id === selectedId}
            onPick={onPickNode}
            onFrame={frameNode}
          />
        ))}
        {focused ? <PulseHalo position={focused.position} /> : null}
      </Canvas>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {labelNodes.map((n) => (
          <NodeLabel
            key={n.id}
            node={n}
            projected={projected}
            focused={n.id === focusedId}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: PAPER, overflow: "hidden" },
  labelWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    width: LABEL_W,
    alignItems: "center",
  },
  labelCat: {
    fontFamily: Sirius.font.serif,
    fontSize: 13,
    lineHeight: 16,
    color: Sirius.color.inkMuted,
    textAlign: "center",
  },
  labelFocused: {
    fontSize: 15,
    lineHeight: 18,
    color: Sirius.color.ink,
  },
  labelProject: {
    fontFamily: Sirius.font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
    textAlign: "center",
  },
  labelChip: {
    borderWidth: 1,
    borderColor: Sirius.color.accentRing,
    backgroundColor: Sirius.color.paper,
    paddingHorizontal: Sirius.space.sm,
    paddingVertical: 3,
  },
  labelPost: {
    fontFamily: Sirius.font.serif,
    fontSize: 13,
    color: Sirius.color.ink,
  },
});
