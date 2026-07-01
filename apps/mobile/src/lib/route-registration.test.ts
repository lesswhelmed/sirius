// Regression guard for the "pushed page has no native header" bug class.
//
// The root stack (`src/app/_layout.tsx`) sets `headerShown: false` globally,
// then re-enables the native header for each pushed content page individually
// via `<Stack.Screen name="X" options={{ headerShown: true, ... }} />`. If a
// pushed route is *missing* from that list (the exact Groups + Group-editor bug
// we just fixed), it renders under the global default: NO back arrow and NO top
// padding (content slides under the status bar). This test fails the moment a
// pushed route under `src/app` is not registered with a native header.
//
// It parses `_layout.tsx` as TEXT (no expo-router / RN import — pure Bun/Node),
// so it runs in `bun:test` without a native runtime. The human-readable
// header-audit table that mirrors this contract lives in
// `apps/mobile/docs/ROUTES.md`.
//
// Contract encoded here:
//   - route name = path under src/app minus `.tsx`, `index` segment KEPT
//     (this layout registers `post/[slug]/index`, not `post/[slug]`).
//   - Redirect-only routes (they render `<Redirect .../>`, e.g. `index`,
//     `queue`) are allowed to be headerless.
//   - Modal routes (`presentation: "modal"`) satisfy the contract too — a modal
//     header may be hidden by design.
//   - `(auth)/` and `(tabs)/` own their own layouts/tab bar (no back-header
//     contract) and are excluded, as is every `_layout.tsx`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "bun:test";

const APP_DIR = join(import.meta.dir, "..", "app");
const LAYOUT_PATH = join(APP_DIR, "_layout.tsx");

interface Registration {
  headerShown: boolean;
  modal: boolean;
}

// Parse every `<Stack.Screen name="NAME" ... />` block out of the layout text
// and record, per name, whether it opts the native header back on and/or is a
// modal. Non-greedy match up to the first `/>` — no Stack.Screen block body in
// this file contains `/>`, so each match is exactly one screen registration.
function parseRegistrations(layoutText: string): Map<string, Registration> {
  const map = new Map<string, Registration>();
  const blockRe = /<Stack\.Screen\b[\s\S]*?\/>/g;
  for (const match of layoutText.matchAll(blockRe)) {
    const block = match[0];
    const nameMatch = block.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    map.set(nameMatch[1], {
      headerShown: /headerShown:\s*true/.test(block),
      modal: /presentation:\s*"modal"/.test(block),
    });
  }
  return map;
}

// file path (relative to src/app, forward slashes) -> expo-router route name.
function toRouteName(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/\.tsx$/, "");
}

function isExcluded(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  if (p === "_layout.tsx" || p.endsWith("/_layout.tsx")) return true;
  if (p.startsWith("(auth)/") || p.startsWith("(tabs)/")) return true;
  return false;
}

// A route file is a "redirect-only" (allowed-headerless) page if it renders a
// `<Redirect .../>` — those never present a back-header surface.
function isRedirectRoute(absPath: string): boolean {
  return /<Redirect\b/.test(readFileSync(absPath, "utf8"));
}

function enumerateRouteFiles(): string[] {
  const glob = new Bun.Glob("**/*.tsx");
  const files: string[] = [];
  for (const rel of glob.scanSync({ cwd: APP_DIR })) {
    if (!isExcluded(rel)) files.push(rel.replace(/\\/g, "/"));
  }
  return files.sort();
}

test("every pushed-content route is registered with a native header in _layout.tsx", () => {
  const registrations = parseRegistrations(readFileSync(LAYOUT_PATH, "utf8"));
  const routeFiles = enumerateRouteFiles();
  expect(routeFiles.length).toBeGreaterThan(0);

  const violations: { route: string; file: string; reason: string }[] = [];

  for (const rel of routeFiles) {
    const abs = join(APP_DIR, rel);
    // Redirect-only routes are allowed to be headerless.
    if (isRedirectRoute(abs)) continue;

    const route = toRouteName(rel);
    const reg = registrations.get(route);
    if (!reg) {
      violations.push({
        route,
        file: `src/app/${rel}`,
        reason:
          "pushed route not registered in _layout.tsx → renders with no back arrow / no top padding (content under the status bar); add a <Stack.Screen name=\"" +
          route +
          '" options={{ headerShown: true }} /> in _layout.tsx',
      });
      continue;
    }
    if (!reg.headerShown && !reg.modal) {
      violations.push({
        route,
        file: `src/app/${rel}`,
        reason:
          "registered but with headerShown:false and not a modal → no back arrow / no top padding; set options.headerShown:true (or presentation:\"modal\" if intended)",
      });
    }
  }

  // On failure, surface each offending route + file + why.
  expect(violations).toEqual([]);
});

test("known pushed routes stay registered with headerShown:true (catches a future flip to false)", () => {
  const registrations = parseRegistrations(readFileSync(LAYOUT_PATH, "utf8"));
  for (const route of ["groups", "group/[id]", "friends", "space"]) {
    const reg = registrations.get(route);
    expect(reg, `${route} must be registered in _layout.tsx`).toBeDefined();
    expect(
      reg?.headerShown,
      `${route} must keep headerShown:true (a native back-header)`,
    ).toBe(true);
  }
});
