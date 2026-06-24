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
import type { Ref, RefObject } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { SharedValue } from "react-native-reanimated";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, Text, View } from "react-native";
import {
  BackSide,
  type Camera,
  Color,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type PerspectiveCamera,
  Vector3,
} from "three";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

type Vec3 = [number, number, number];

// Editorial palette — ink dots on paper, oxblood for the one focused node.
// Resolved per-theme from the active Theme so the scene tracks light/dark.
interface Palette {
  paper: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  oxblood: string;
  mark: string;
}
function makePalette(t: Theme): Palette {
  return {
    paper: t.color.paper,
    ink: t.color.ink,
    inkMuted: t.color.inkMuted,
    inkFaint: t.color.inkFaint,
    oxblood: t.color.accent,
    mark: t.color.mark,
  };
}

// Color-by-cluster: every node is tinted by its TOP-LEVEL taxonomy branch, so a
// whole topic family (the branch category, its sub-categories, and the posts
// filed under them) shares ONE hue. Hues are spread evenly around the wheel and
// assigned by sorted branch order so the map reads as a coherent rainbow of
// topics — not random per-node noise. Saturation/lightness are deliberately
// muted (not neon) so the colors sit on BOTH the cream (light) and navy (dark)
// paper without screaming; the focused node still overrides to oxblood so focus
// always pops against the family colors.
const CLUSTER_SAT = 50;
const CLUSTER_LIGHT = 58;

// The branch a path/cluster belongs to: the top-level taxonomy node — the first
// two path segments (e.g. "topics/internet"), since `topics` is the virtual
// root. Everything beneath it, and every post whose dominant category is beneath
// it, shares the branch color.
function branchKey(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split("/").slice(0, 2).join("/");
}

// A node's branch key: a category uses its own path; a post uses its dominant
// category (`clusterId`); projects have no family.
function nodeBranch(node: SceneNode): string | null {
  if (node.kind === "category") return branchKey(node.path);
  if (node.kind === "post") return branchKey(node.clusterId);
  return null;
}

// Stable hue per branch. Distinct branches are sorted then spread evenly around
// the wheel, so the same branch is the same color every render (deterministic =
// a learnable map) and adjacent families are easy to tell apart.
function buildClusterColors(scene: EmbeddingScene): Map<string, string> {
  const branches = new Set<string>();
  for (const n of scene.nodes) {
    const key = nodeBranch(n);
    if (key) branches.add(key);
  }
  const sorted = [...branches].sort();
  const colors = new Map<string, string>();
  const n = Math.max(1, sorted.length);
  sorted.forEach((key, i) => {
    const hue = Math.round((i * 360) / n + 15) % 360;
    colors.set(key, `hsl(${hue}, ${CLUSTER_SAT}%, ${CLUSTER_LIGHT}%)`);
  });
  return colors;
}

function clusterColorOf(
  node: SceneNode,
  clusterColors: Map<string, string>,
): string | null {
  const key = nodeBranch(node);
  return key ? (clusterColors.get(key) ?? null) : null;
}

const DAMPING = 0.16; // orbit + target + radius easing per frame (OrbitControls feel)

// Camera framing, all DERIVED from the scene's own extent (radius R) so any map
// — tiny or sprawling — is framed sensibly. FIT_MULT*R is the zoom=1 distance
// that frames the whole sphere (~17% margin at fov 52). Pinch scales it live.
const FIT_MULT = 2.4;
const ZOOM_MIN = 0.18; // closest: lean in on a single node
const ZOOM_MAX = 1.15; // farthest: never pull back past the whole-scene fit
const PAN_LIMIT_MULT = 1.1; // look-at target may stray at most R*1.1 from center
const PAN_SCALE = 0.9; // NDC-delta → world units (scaled by live radius)
// Frame zoom levels — pulled back enough that framing a node also shows the
// posts around it (their relationship), rather than filling the screen with just
// the node. Posts frame a touch wider still (a lone point shouldn't dominate).
const FRAME_ZOOM = 0.44; // explicit "Frame" / auto-frame on a category
const FRAME_ZOOM_POST = 0.52; // a tapped post
const NEIGHBORHOOD_ZOOM = 0.55; // default lean-in: frame the focused branch, not the whole cloud

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
  const center: Vec3 = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
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
  palette,
}: {
  scene: EmbeddingScene;
  focusedId: string | null;
  onlyFocus: boolean;
  palette: Palette;
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
        color={onlyFocus ? palette.oxblood : palette.ink}
        transparent
        opacity={onlyFocus ? 0.6 : 0.06}
      />
    </lineSegments>
  );
}

// The post↔post similarity links — the heart of the mind map. Drawn only
// between posts that are BOTH in the focused branch (so they appear with the
// branch's posts under focus+context, never as global clutter), in the editorial
// `mark` tone so they read as a distinct relationship from the ink taxonomy + the
// oxblood focus edges.
function SimilarityEdges({
  scene,
  subtreePostIds,
  clusterColors,
  palette,
}: {
  scene: EmbeddingScene;
  subtreePostIds: Set<string>;
  clusterColors: Map<string, string>;
  palette: Palette;
}) {
  const { positions, colors } = useMemo(() => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    const verts: number[] = [];
    const cols: number[] = [];
    const c = new Color();
    for (const e of scene.edges) {
      if (e.kind !== "similarity") continue;
      if (!subtreePostIds.has(e.from) || !subtreePostIds.has(e.to)) continue;
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      verts.push(...a.position, ...b.position);
      // Tint the link by its endpoints' topic family so a link reads as part of
      // a cluster, not a neutral wire. Both posts in a similarity pair are nearly
      // always the same family; use endpoint a's hue for the whole segment.
      c.set(clusterColorOf(a, clusterColors) ?? palette.mark);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    return {
      positions: new Float32Array(verts),
      colors: new Float32Array(cols),
    };
  }, [scene, subtreePostIds, clusterColors, palette.mark]);
  if (positions.length === 0) return null;
  return (
    <lineSegments key={`sim:${positions.length}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={0.45} />
    </lineSegments>
  );
}

// Every node — category, post, project — is drawn as ONE instance in two shared
// instanced meshes: a visible opaque dot + a full-size invisible hit halo so even
// dimmed/slug-less posts stay tappable. Single tap selects; double tap frames.
const HIT_FACTOR = 3.5;
const HIT_MIN = 0.55;
const KIND_BASE: Record<string, number> = {
  category: 0.13,
  post: 0.075,
  project: 0.11,
};
const DOUBLE_TAP_MS = 300;

// Importance → radius multiplier. A category's `weight` is how many posts it
// holds; a post's is its link degree. Bigger hubs read as bigger dots, but the
// growth is sub-linear (sqrt) and capped so one giant branch can't dominate.
function weightScale(weight: number | undefined): number {
  return 1 + Math.min(0.9, Math.sqrt(weight ?? 0) / 6);
}

// Per-instance visual tier: the radius scale, the dot color, and how far to lerp
// that color toward PAPER (= the prior opacity tier, since an opaque instanced
// mesh can't do per-instance opacity — on paper a ~55% lerp reads like 0.55).
// `hidden` collapses a node to nothing: this is the focus+context rule — posts
// outside the focused branch (and ALL posts before anything is focused) drop out
// so the default view is a clean category constellation, not a post swarm.
function nodeStyle(
  node: SceneNode,
  focused: boolean,
  neighbor: boolean,
  inSubtree: boolean,
  hidden: boolean,
  clusterColor: string | null,
  palette: Palette,
): { radius: number; color: string; fade: number } {
  if (hidden) return { radius: 0, color: palette.inkFaint, fade: 1 };
  const base = (KIND_BASE[node.kind] ?? 0.1) * weightScale(node.weight);
  const radius = focused ? base * 1.9 : neighbor ? base * 1.15 : base;

  // Focus overrides to oxblood so it pops; otherwise a node wears its topic
  // family's hue (categories + posts). Fall back to ink tones when a node has no
  // branch (e.g. a project, or a post the model never categorized).
  let color: string = palette.inkFaint;
  if (focused) color = palette.oxblood;
  else if (clusterColor) color = clusterColor;
  else if (neighbor) color = palette.ink;
  else if (node.kind === "project") color = palette.mark;
  else if (node.kind === "post") color = inSubtree ? palette.ink : palette.inkMuted;

  // Prior opacity tiers, expressed as a lerp-toward-PAPER amount (1 - opacity).
  let opacity = Math.max(0.45, KIND_BASE[node.kind] ?? 0.1); // floor so nothing "blacks out"
  if (focused) opacity = 1;
  else if (neighbor) opacity = 0.9;
  else if (inSubtree) opacity = 0.7;
  return { radius, color, fade: 1 - opacity };
}

// The instanced visible dots + invisible hit halos. Matrices + per-instance
// colors are (re)uploaded whenever the scene or any selection-driven tier set
// changes; clicks resolve through e.instanceId back to scene.nodes.
function NodeDots({
  scene,
  focusedId,
  neighborIds,
  subtreePostIds,
  clusterColors,
  onPick,
  onFrame,
  palette,
}: {
  scene: EmbeddingScene;
  focusedId: string | null;
  neighborIds: Set<string>;
  subtreePostIds: Set<string>;
  clusterColors: Map<string, string>;
  onPick: (node: SceneNode) => void;
  onFrame: (node: SceneNode) => void;
  palette: Palette;
}) {
  const dotsRef = useRef<InstancedMesh>(null);
  const hitRef = useRef<InstancedMesh>(null);
  // Double-tap tracking per instance id.
  const lastTap = useRef<{ id: number; t: number }>({ id: -1, t: 0 });

  const count = scene.nodes.length;

  useEffect(() => {
    const dots = dotsRef.current;
    const hit = hitRef.current;
    if (!dots || !hit || count === 0) return;
    const m = new Matrix4();
    const paper = new Color(palette.paper);
    const col = new Color();
    for (let i = 0; i < count; i++) {
      const node = scene.nodes[i]!;
      const focused = node.id === focusedId;
      const neighbor = neighborIds.has(node.id);
      const inSubtree = node.kind === "post" && subtreePostIds.has(node.id);
      // Focus+context: a post is hidden unless it's in the focused branch (so
      // before any focus, every post is hidden → clean category map).
      const hidden = node.kind === "post" && !inSubtree;
      const { radius, color, fade } = nodeStyle(
        node,
        focused,
        neighbor,
        inSubtree,
        hidden,
        clusterColorOf(node, clusterColors),
        palette,
      );
      const [x, y, z] = node.position;
      // Visible dot: unit sphere scaled by the tier radius.
      m.makeScale(radius, radius, radius);
      m.setPosition(x, y, z);
      dots.setMatrixAt(i, m);
      // Color, dimmed by lerping toward the paper background.
      col.set(color).lerp(paper, fade);
      dots.setColorAt(i, col);
      // Hit halo: generous tap target, even for tiny dimmed posts — but a hidden
      // post gets a zero halo so it can't be tapped while invisible.
      const hr = hidden ? 0 : Math.max(radius * HIT_FACTOR, HIT_MIN);
      m.makeScale(hr, hr, hr);
      m.setPosition(x, y, z);
      hit.setMatrixAt(i, m);
    }
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    hit.instanceMatrix.needsUpdate = true;
  }, [
    scene.nodes,
    focusedId,
    neighborIds,
    subtreePostIds,
    clusterColors,
    count,
    palette,
  ]);

  if (count === 0) return null;

  return (
    <>
      <instancedMesh ref={dotsRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={hitRef}
        args={[undefined, undefined, count]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          const id = e.instanceId;
          if (id == null) return;
          const node = scene.nodes[id];
          if (!node) return;
          e.stopPropagation();
          const now = Date.now();
          const prev = lastTap.current;
          if (prev.id === id && now - prev.t < DOUBLE_TAP_MS) onFrame(node);
          else onPick(node);
          lastTap.current = { id, t: now };
        }}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

// The selected post's oxblood ring — a single mesh (only 0-1 ever shown), kept
// separate from the instanced dots.
function SelectedRing({
  node,
  palette,
}: {
  node: SceneNode;
  palette: Palette;
}) {
  const base = KIND_BASE[node.kind] ?? 0.1;
  return (
    <mesh position={node.position}>
      <sphereGeometry args={[base * 2.2, 16, 16]} />
      <meshBasicMaterial
        color={palette.oxblood}
        wireframe
        transparent
        opacity={0.6}
        depthWrite={false}
      />
    </mesh>
  );
}

// Oxblood glow that breathes around the focused node. Lives at a stable ref so
// changing focus only moves its position prop — the animation never restarts.
function PulseHalo({
  position,
  palette,
}: {
  position: Vec3;
  palette: Palette;
}) {
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
        color={palette.oxblood}
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
  // Lazy ref init — `useRef(new Map())` would rebuild + discard a Map every
  // render; this allocates exactly once.
  const ptsRef = useRef<Map<number, { x: number; y: number }> | null>(null);
  const pts = (ptsRef.current ??= new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const pinchMid = useRef<{ x: number; y: number } | null>(null);
  const resetPinch = () => {
    pinchDist.current = null;
    pinchMid.current = null;
  };
  return (
    <mesh
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        pts.set(e.pointerId, { x: e.pointer.x, y: e.pointer.y });
        resetPinch();
        logGesture("down", "id=", e.pointerId, "active=", pts.size);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        const map = pts;
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
        pts.delete(e.pointerId);
        resetPinch();
        logGesture("up", "id=", e.pointerId, "active=", pts.size);
      }}
      onPointerLeave={(e: ThreeEvent<PointerEvent>) => {
        pts.delete(e.pointerId);
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
  sheetRef,
  liftRef,
}: {
  orbit: RefObject<Orbit>;
  target: RefObject<Vec3>;
  zoom: RefObject<number>;
  fitRadius: number;
  initialTarget: Vec3;
  // Height (px) the bottom sheet currently occupies — the camera lifts the
  // look-at target by HALF this so the focused node sits centered in the space
  // ABOVE the sheet instead of behind it. 0 when no sheet is shown.
  sheetRef: RefObject<number>;
  // CameraRig writes its eased lift here each frame so the label projector can
  // reproject when the framing shifts but the camera position hasn't moved.
  liftRef: RefObject<number>;
}) {
  const curOrbit = useRef<Orbit>({ ...orbit.current });
  const curTarget = useRef<Vec3>([...initialTarget] as Vec3);
  const curRadius = useRef<number>(fitRadius * zoom.current);
  // Starts at 0 and eases toward sheetRef each frame (reading the ref here during
  // render trips react-hooks/refs); the tiny one-time settle on mount reads fine.
  const curSheet = useRef<number>(0);
  useFrame((state) => {
    const o = curOrbit.current;
    o.yaw += (orbit.current.yaw - o.yaw) * DAMPING;
    o.pitch += (orbit.current.pitch - o.pitch) * DAMPING;
    const c = curTarget.current;
    for (let i = 0; i < 3; i++) {
      c[i] += (target.current[i]! - c[i]!) * DAMPING;
    }
    curRadius.current +=
      (fitRadius * zoom.current - curRadius.current) * DAMPING;
    const r = curRadius.current;
    state.camera.position.set(
      c[0]! + r * Math.cos(o.pitch) * Math.sin(o.yaw),
      c[1]! + r * Math.sin(o.pitch),
      c[2]! + r * Math.cos(o.pitch) * Math.cos(o.yaw),
    );
    state.camera.lookAt(c[0]!, c[1]!, c[2]!);

    // Lift the framing above the bottom sheet. setViewOffset shifts the
    // projection's principal point up by `lift` px (= half the sheet height),
    // so the centered look-at target lands in the middle of the visible band
    // above the sheet. Applied AFTER lookAt and BEFORE render so the projection
    // is current for this frame's draw and the label projector below.
    curSheet.current += (sheetRef.current - curSheet.current) * DAMPING;
    const cam = state.camera as unknown as PerspectiveCamera;
    const w = state.size?.width ?? 0;
    const h = state.size?.height ?? 0;
    const lift = curSheet.current / 2;
    liftRef.current = lift;
    if (h > 0 && lift > 0.5) cam.setViewOffset(w, h, 0, lift, w, h);
    else if (cam.view?.enabled) cam.clearViewOffset();

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
  sv.set(value);
}

// Priority-2 useFrame (runs AFTER CameraRig rendered, so camera matrices are
// fresh). Projects each labeled node to screen px + a distance/clip opacity and
// writes the map into a shared value. NEVER calls gl.render — CameraRig stays the
// only renderer. No React state per frame.
function LabelProjector({
  nodes,
  projected,
  fitRadius,
  liftRef,
}: {
  nodes: SceneNode[];
  projected: SharedValue<Record<string, ProjectedLabel>>;
  fitRadius: number;
  // The camera rig's current framing lift (px). When it eases — moving every
  // dot on screen while the camera position holds still — labels must reproject
  // too, or they'd float away from their dots.
  liftRef: RefObject<number>;
}) {
  // Lazy ref init — one Vector3 reused for every projection, not a throwaway
  // per render.
  const vRef = useRef<Vector3 | null>(null);
  const v = (vRef.current ??= new Vector3());
  const lastCam = useRef<Vec3>([Infinity, 0, 0]);
  const lastLift = useRef<number>(Infinity);
  useFrame((state) => {
    const cam = state.camera;
    // Skip the (expensive-ish) shared-value write when the camera is at rest AND
    // the framing lift is settled (either alone can move labels on screen).
    const moved =
      Math.abs(cam.position.x - lastCam.current[0]) +
        Math.abs(cam.position.y - lastCam.current[1]) +
        Math.abs(cam.position.z - lastCam.current[2]) >
        0.0006 || Math.abs(liftRef.current - lastLift.current) > 0.5;
    if (!moved) return;
    lastCam.current = [cam.position.x, cam.position.y, cam.position.z];
    lastLift.current = liftRef.current;

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
      v.set(n.position[0], n.position[1], n.position[2]);
      // Dual-@types/three identity mismatch (root vs apps/mobile) — cast the
      // fiber camera to this package's three Camera type for .project().
      v.project(cam as unknown as Camera);
      let o = 0;
      if (v.z <= 1) {
        o = 1 - (dist - near) / (far - near);
        o = Math.max(0, Math.min(1, o));
      }
      out[n.id] = {
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
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
  const styles = useThemedStyles(makeStyles);
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
  // Height (px) the host's bottom sheet currently occupies. The camera lifts the
  // focused node by half this so the sheet never covers it. 0 = no sheet.
  sheetHeight?: number;
  style?: StyleProp<ViewStyle>;
}

// SHARED INTERFACE CONTRACT — exported here, imported by the map-view host. The
// host calls frameNode() (its "Frame" action) instead of bumping a prop tick.
export type ConstellationHeroHandle = {
  /** Gently fly the camera in close on a node (the "Frame" action). */
  frameNode: (node: SceneNode) => void;
};

// Self-contained 3D hero. Mount it at a fixed height; it fills its container.
export function ConstellationHero({
  scene,
  focused,
  neighborIds,
  subtreePostIds,
  selectedNode,
  onPickNode,
  sheetHeight = 0,
  style,
  ref,
}: ConstellationHeroProps & { ref?: Ref<ConstellationHeroHandle> }) {
  const t = useTheme();
  const palette = makePalette(t);
  const styles = useThemedStyles(makeStyles);
  const bounds = computeBounds(scene.nodes);
  const fitRadius = bounds.radius * FIT_MULT;
  const panLimit = bounds.radius * PAN_LIMIT_MULT;
  // Stable per-topic-family hues, recomputed only when the node set changes.
  const clusterColors = useMemo(() => buildClusterColors(scene), [scene]);

  // Bottom-sheet framing lift, held in refs so the per-frame camera rig reads the
  // latest without re-rendering the Canvas tree. `liftRef` is the eased value the
  // rig writes back for the label projector to track.
  const sheetRef = useRef(sheetHeight);
  useEffect(() => {
    sheetRef.current = sheetHeight;
  }, [sheetHeight]);
  const liftRef = useRef(0);

  const orbit = useRef<Orbit>({ yaw: 0.6, pitch: 0.32 });
  // Live pinch multiplier on fitRadius, kept across selection so the user's zoom
  // survives flying to a new node.
  const zoom = useRef<number>(1);
  // The eased look-at point. Init at scene center (whole-map fit); moved only by
  // the user's pan and by gentle fly-to — never hard-snapped on selection.
  const target = useRef<Vec3>([...bounds.center]);
  // The look-at id already applied by the auto-frame effect (or by init), so a
  // change can be detected without re-framing the same node twice.
  const prevLookId = useRef<string | null | undefined>(undefined);

  // Explicit "Frame" — fly in close on a node. The eased rig turns this into a
  // smooth fly-in (no snap). Exposed imperatively to the host (its "Frame" button
  // calls ref.frameNode(...)), reused by double-tap, AND reused for auto-framing
  // on open + on every selection/focus change below. Posts frame a touch wider
  // than categories so a preview tap doesn't over-zoom into a lone point.
  const frameNode = (node: SceneNode) => {
    target.current = [...node.position];
    const z = node.kind === "post" ? FRAME_ZOOM_POST : FRAME_ZOOM;
    zoom.current = Math.max(ZOOM_MIN, z);
  };
  useImperativeHandle(ref, () => ({ frameNode }));

  // The node the camera should be looking at: the explicit selection, else the
  // focused category.
  const lookAtNode = selectedNode ?? focused;
  const lookAtId = lookAtNode?.id ?? null;

  // One-time framing on open: auto-frame the initial focused node (eased tight
  // frame, matching the manual "Frame" action). With no initial focus, fall back
  // to the whole-scene fit so an empty/unfocused map still shows the full cloud.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (lookAtNode) {
      frameNode(lookAtNode);
    } else {
      target.current = [...bounds.center];
      zoom.current = NEIGHBORHOOD_ZOOM;
    }
    // Mark the initial look-at as already-applied so the change effect below
    // doesn't immediately re-frame the same node.
    prevLookId.current = lookAtId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds]);

  // Auto-frame whenever the look-at node changes — keeps it eased (no pan reset,
  // interruptible: the next pan/orbit just overrides `target`). Frames BOTH
  // categories and posts, so selecting a sibling ‹ ›, a child "Inside" chip, a
  // post row, or a "Related" item from the bottom sheet flies the camera in.
  useEffect(() => {
    if (lookAtId == null || lookAtId === prevLookId.current) return;
    prevLookId.current = lookAtId;
    if (lookAtNode) frameNode(lookAtNode);
  }, [lookAtId, lookAtNode]);

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
    zoom.current = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, zoom.current * factor),
    );
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

  // Which nodes get an overlay label: all categories/projects (capped so a huge
  // taxonomy doesn't clutter — then we keep focus + neighbors + parent), plus
  // the currently selected post.
  const projected = useSharedValue<Record<string, ProjectedLabel>>({});
  // Focus + context: label ONLY the focused node and its direct neighbors
  // (parent + children via taxonomy edges) so labels never pile up — every other
  // topic stays a faint, unlabeled dot until you navigate to it. Before anything
  // is focused, fall back to the first MAX_CATEGORY_LABELS structural labels so
  // the map isn't blank on entry.
  const structuralLabels = scene.nodes.filter((n) => n.kind !== "post");
  const keptLabels =
    focusedId == null
      ? structuralLabels.slice(0, MAX_CATEGORY_LABELS)
      : structuralLabels.filter(
          (n) => n.id === focusedId || neighborIds.has(n.id),
        );
  const labelNodes =
    selectedNode?.kind === "post" ? [...keptLabels, selectedNode] : keptLabels;

  return (
    <View style={[styles.hero, style]}>
      <Canvas camera={{ fov: 52 }}>
        <color attach="background" args={[palette.paper]} />
        <CameraRig
          orbit={orbit}
          target={target}
          zoom={zoom}
          fitRadius={fitRadius}
          initialTarget={bounds.center}
          sheetRef={sheetRef}
          liftRef={liftRef}
        />
        <LabelProjector
          nodes={labelNodes}
          projected={projected}
          fitRadius={fitRadius}
          liftRef={liftRef}
        />
        <OrbitBackdrop onOrbit={onOrbitDelta} onZoom={onZoom} onPan={onPan} />
        <ambientLight intensity={1} />
        <EdgeLines
          scene={scene}
          focusedId={focusedId}
          onlyFocus={false}
          palette={palette}
        />
        <EdgeLines
          scene={scene}
          focusedId={focusedId}
          onlyFocus
          palette={palette}
        />
        <SimilarityEdges
          scene={scene}
          subtreePostIds={subtreePostIds}
          clusterColors={clusterColors}
          palette={palette}
        />
        <NodeDots
          scene={scene}
          focusedId={focusedId}
          neighborIds={neighborIds}
          subtreePostIds={subtreePostIds}
          clusterColors={clusterColors}
          onPick={onPickNode}
          onFrame={frameNode}
          palette={palette}
        />
        {selectedNode && selectedNode.id !== focusedId ? (
          <SelectedRing node={selectedNode} palette={palette} />
        ) : null}
        {focused ? (
          <PulseHalo position={focused.position} palette={palette} />
        ) : null}
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

function makeStyles(t: Theme) {
  return StyleSheet.create({
    hero: { backgroundColor: t.color.paper, overflow: "hidden" },
    labelWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      width: LABEL_W,
      alignItems: "center",
    },
    labelCat: {
      fontFamily: t.font.serif,
      fontSize: 13,
      lineHeight: 16,
      color: t.color.inkMuted,
      textAlign: "center",
    },
    labelFocused: {
      fontSize: 15,
      lineHeight: 18,
      color: t.color.ink,
    },
    labelProject: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
      textAlign: "center",
    },
    labelChip: {
      borderWidth: 1,
      borderColor: t.color.accentRing,
      backgroundColor: t.color.paper,
      paddingHorizontal: t.space.sm,
      paddingVertical: 3,
    },
    labelPost: {
      fontFamily: t.font.serif,
      fontSize: 13,
      color: t.color.ink,
    },
  });
}
