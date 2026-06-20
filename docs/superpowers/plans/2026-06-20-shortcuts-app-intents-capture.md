# Shortcuts App Intents "Capture in Sirius" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native iOS "Capture in Sirius" action to the Shortcuts app (and as a Siri phrase) that opens the app and queues text/links through the existing authenticated submit pipeline.

**Architecture:** A native App Intent (`openAppWhenRun = true`) opens `siriusapp://capture?text=…`; a new Expo Router screen turns the param into `Material[]` via a shared `materialsFromText()` helper and submits through the existing `submitMaterials` + better-auth session. The Swift is injected into the main iOS target by a local Expo config plugin (the `ios/` dir is gitignored/regenerated, so it must be plugin-driven).

**Tech Stack:** Expo SDK 56 / React Native 0.85, Expo Router (typed routes), `@expo/config-plugins` (transitive via `expo` — no new dep), Swift App Intents (iOS 16+), better-auth Expo client.

**Spec:** `docs/superpowers/specs/2026-06-20-shortcuts-app-intents-capture-design.md`

## Global Constraints

- Scope is `apps/mobile` only. No `apps/web`, no server, no DB, no changes to `/api/app/ingest`, `submitMaterials` semantics, or auth.
- No new npm dependency: use `@expo/config-plugins`, which ships transitively with `expo`.
- All Swift gated `@available(iOS 16.0, *)`.
- `ios/` and `android/` are gitignored — never commit them; native changes live in the config plugin + `ios-intents/` sources.
- URL scheme is `siriusapp` (`app.json` → `expo.scheme`).
- **No test runner exists in this repo.** "Verify" = `bun run check-types`, `bun run lint`, a clean `expo prebuild` sanity check, deep-link simulation, and the manual on-device flow. Do NOT claim unit tests pass.
- **Concurrent swarm on `main`.** Each phase: reserve its paths in Agent Mail (agent `StormyMeadow`) before editing, commit by **explicit path only** (never `git add -A`), release the reservations after the phase's commit. Re-check the inbox (`fetch_inbox`) at each phase boundary.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/mobile/src/lib/materials.ts` (modify) | Extract `materialsFromText()` + `applyNote()` helpers; reuse inside `materialsFromShareIntent`. |
| `apps/mobile/src/app/shareintent.tsx` (modify) | Use the shared `applyNote()` (drop the local `applyShareNote`). |
| `apps/mobile/src/app/capture.tsx` (create) | New screen: reads `text` param → `materialsFromText` → confirm UI → `submitMaterials`. |
| `apps/mobile/src/app/+native-intent.ts` (modify) | Route `siriusapp://capture?text=…` to `/capture`. |
| `apps/mobile/plugins/with-capture-intents.js` (create) | Config plugin: copy Swift into main iOS target + add to Sources build phase. |
| `apps/mobile/ios-intents/CaptureInSiriusIntent.swift` (create) | The `AppIntent` (opens the capture deep link). |
| `apps/mobile/ios-intents/SiriusShortcuts.swift` (create) | `AppShortcutsProvider` declaring the Siri phrase. |
| `apps/mobile/app.json` (modify) | Register the config plugin in `plugins[]`. |

---

# Phase 1 — JS/TS capture path (no native build required)

**Why first:** This entire phase is verifiable by simulating the deep link with `xcrun simctl openurl booted "siriusapp://capture?text=…"` against the *existing* dev client — no rebuild. It proves the routing + submit path independently of any Swift.

### Phase 1 reservation (do before Task 1)

```
file_reservation_paths(
  project_key="/Users/minasaleeb/workspaces/sirius-2-simple",
  agent_name="StormyMeadow",
  paths=[
    "apps/mobile/src/lib/materials.ts",
    "apps/mobile/src/app/shareintent.tsx",
    "apps/mobile/src/app/capture.tsx",
    "apps/mobile/src/app/+native-intent.ts"
  ],
  ttl_seconds=5400, exclusive=true, reason="shortcuts app-intents phase 1 (JS path)"
)
```
If any path conflicts: stop, message the holder, wait for expiry. Do not edit a conflicted path.

---

### Task 1: Extract shared `materialsFromText()` + `applyNote()` in `materials.ts`

**Files:**
- Modify: `apps/mobile/src/lib/materials.ts` (the text branch inside `materialsFromShareIntent`, ~lines 188–210; add two exports)

**Interfaces:**
- Produces: `export function materialsFromText(text: string): Material[]` — parses free text into `url` + `note` materials (pulls an embedded URL if present, remainder becomes a note; empty/whitespace text → `[]`).
- Produces: `export function applyNote(materials: Material[], note: string | undefined): Material[]` — stamps an optional note onto each material (moved verbatim from `shareintent.tsx`'s `applyShareNote`).
- Consumes: existing internal `URL_IN_TEXT_REGEX` (already defined in this file).

- [ ] **Step 1: Add the `materialsFromText` export.** Place it directly above `materialsFromShareIntent`. This is the existing text-branch logic, generalized to a single string:

```ts
// Parse a single free-text string into materials: pull an embedded URL out if
// present (remainder becomes a note), otherwise the whole string is a note.
// Shared by the share-intent flow and the App Intent /capture screen.
export function materialsFromText(text: string): Material[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const materials: Material[] = [];
  const match = trimmed.match(URL_IN_TEXT_REGEX)?.[0];
  if (match) {
    materials.push({ kind: "url", url: match });
    const remainder = trimmed.replace(match, "").trim();
    if (remainder.length > 0) {
      materials.push({ kind: "note", text: remainder });
    }
  } else {
    materials.push({ kind: "note", text: trimmed });
  }
  return materials;
}
```

- [ ] **Step 2: Reuse it inside `materialsFromShareIntent`.** Replace the inline `else { ... match ... }` block (the loop body that builds url/note from `text`) so the no-`webUrl` case delegates to `materialsFromText`. The loop becomes:

```ts
  for (const text of noteCandidates) {
    // Skip text that's just the URL we already captured.
    if (webUrl && text.includes(webUrl)) continue;
    if (webUrl) {
      // We already have the link; the text is a note alongside it.
      materials.push({ kind: "note", text });
    } else {
      materials.push(...materialsFromText(text));
    }
  }
```

- [ ] **Step 3: Add the `applyNote` export.** Move the body of `applyShareNote` from `shareintent.tsx` into `materials.ts` (rename to `applyNote`):

```ts
// Apply an optional note to every material: stamp it onto kinds that carry a
// `notes` field, and merge it into a note's text (its text IS the content).
export function applyNote(
  materials: Material[],
  note: string | undefined,
): Material[] {
  if (!note) return materials;
  return materials.map((m) => {
    if (m.kind === "note") {
      return { ...m, text: `${m.text}\n\nAuthor's notes: ${note}` };
    }
    if (m.kind === "unsupported") return m;
    return { ...m, notes: note };
  });
}
```

- [ ] **Step 4: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS (no errors in `apps/mobile`).

- [ ] **Step 5: Commit.**

```bash
git add apps/mobile/src/lib/materials.ts
git commit -m "refactor(mobile): extract materialsFromText + applyNote helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Switch `shareintent.tsx` to the shared `applyNote`

**Files:**
- Modify: `apps/mobile/src/app/shareintent.tsx` (remove local `applyShareNote`, import `applyNote`)

**Interfaces:**
- Consumes: `applyNote` from `@/lib/materials` (Task 1).

- [ ] **Step 1: Delete the local `applyShareNote` function** (lines ~37–52) and add `applyNote` to the existing `@/lib/materials` import:

```ts
import {
  applyNote,
  describeMaterial,
  type Material,
  materialsFromShareIntent,
  submitMaterials,
} from "@/lib/materials";
```

- [ ] **Step 2: Update the call site** in `submit()`:

```ts
      const result = await submitMaterials(
        applyNote(materials, note.trim() || undefined),
        { force: false },
      );
```

- [ ] **Step 3: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/mobile/src/app/shareintent.tsx
git commit -m "refactor(mobile): use shared applyNote in shareintent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create the `/capture` screen

**Files:**
- Create: `apps/mobile/src/app/capture.tsx`

**Interfaces:**
- Consumes: `materialsFromText`, `applyNote`, `submitMaterials`, `describeMaterial`, `type Material` from `@/lib/materials`; `useSession` from `@/lib/auth-client`; `trayTag` from `@/lib/material-kinds`; UI from `@/components/sirius`.
- Route: Expo Router auto-registers `capture.tsx` as `/capture`. Reads `useLocalSearchParams<{ text?: string }>()` (already percent-decoded by the router).

- [ ] **Step 1: Write the screen.** It mirrors `shareintent.tsx` (auth gate, empty state, confirm + optional note, submit → Queue) but sources materials from the `text` param:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Field,
  KeyboardDoneButton,
  PageHeader,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextLink,
  TrayRow,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { useSession } from "@/lib/auth-client";
import { trayTag } from "@/lib/material-kinds";
import {
  applyNote,
  describeMaterial,
  type Material,
  materialsFromText,
  submitMaterials,
} from "@/lib/materials";

export default function CaptureScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ text?: string }>();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const incoming = typeof params.text === "string" ? params.text : "";
  const materials = useMemo<Material[]>(
    () => materialsFromText(incoming),
    [incoming],
  );
  const submittable = materials.filter((m) => m.kind !== "unsupported");

  async function submit() {
    if (busy || submittable.length === 0) return;
    setBusy(true);
    let errors: string[] = [];
    try {
      const result = await submitMaterials(
        applyNote(materials, note.trim() || undefined),
        { force: false },
      );
      errors = result.errors;
    } finally {
      setBusy(false);
    }
    if (errors.length > 0) {
      Alert.alert("Some submissions failed", errors.join("\n\n"));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.replace("/(tabs)/queue");
  }

  if (isPending) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={Sirius.color.accent} />
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen style={styles.centeredPad}>
        <PageHeader title="Sign in to capture this" titleAccent="." />
        <Text style={styles.muted}>
          Your text is waiting. Sign in and run the shortcut again to queue it.
        </Text>
        <PrimaryButton
          label="Sign in"
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </Screen>
    );
  }

  if (submittable.length === 0) {
    return (
      <Screen style={styles.centeredPad}>
        <PageHeader title="Nothing to capture" titleAccent="." />
        <Text style={styles.muted}>
          Run “Capture in Sirius” with a note or link to queue it.
        </Text>
        <SecondaryButton
          label="Go to queue"
          onPress={() => router.replace("/(tabs)/queue")}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <PageHeader
            brandMark
            eyebrow="Capture in Sirius"
            title="Queue this"
            titleAccent="."
            subtitle={`${submittable.length} item${
              submittable.length === 1 ? "" : "s"
            } ready to send to the worker.`}
          />

          <View style={styles.list}>
            {materials.map((material, i) => (
              <TrayRow
                key={`${material.kind}:${describeMaterial(material)}:${i}`}
                tag={trayTag(material)}
                description={describeMaterial(material)}
              />
            ))}
          </View>

          <Field
            label="Notes (optional)"
            style={styles.noteInput}
            placeholder="What interests you about this…"
            multiline
            autoCapitalize="sentences"
            value={note}
            onChangeText={setNote}
          />
          <KeyboardDoneButton style={styles.keyboardDone} />

          <PrimaryButton label="Queue it" onPress={submit} busy={busy} />

          <TextLink
            label="Cancel"
            tone={Sirius.color.inkMuted}
            onPress={() => router.replace("/(tabs)/queue")}
            disabled={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noteInput: { minHeight: 80, textAlignVertical: "top", paddingTop: 12 },
  keyboardDone: { alignSelf: "flex-end" },
  centered: { alignItems: "center", justifyContent: "center" },
  centeredPad: {
    justifyContent: "center",
    paddingHorizontal: Sirius.space.xl,
    gap: Sirius.space.lg,
  },
  container: { padding: Sirius.space.xl, paddingTop: 72, gap: Sirius.space.lg },
  muted: {
    color: Sirius.color.inkMuted,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 23,
  },
  list: { gap: Sirius.space.sm, marginTop: Sirius.space.xs },
});
```

- [ ] **Step 2: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS. (`/capture` should also appear in the generated typed-routes union after `expo` typegen runs during check-types.)

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/src/app/capture.tsx
git commit -m "feat(mobile): /capture screen for App Intent deep link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Route `siriusapp://capture?…` in `+native-intent.ts`

**Files:**
- Modify: `apps/mobile/src/app/+native-intent.ts`

**Interfaces:**
- Produces: deterministic routing of any incoming deep link whose base path ends in `capture` to `/capture`, preserving the query string.

- [ ] **Step 1: Extend `redirectSystemPath`.** Add the capture rule after the existing share-intent rule, keeping the try/catch:

```ts
import { getShareExtensionKey } from "expo-share-intent";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return "/shareintent";
    }
    // App Intents (Shortcuts/Siri "Capture in Sirius") open the app on
    // siriusapp://capture?text=<encoded>. Custom-scheme parsing can place
    // "capture" as host or first path segment, so normalize either form to the
    // /capture route and forward the query string verbatim.
    const [rawBase, query] = path.split("?");
    const base = rawBase.replace(/^.*?:\/\//, "").replace(/^\/+/, "");
    if (base === "capture" || base.endsWith("/capture")) {
      return query ? `/capture?${query}` : "/capture";
    }
    return path;
  } catch {
    return "/";
  }
}
```

- [ ] **Step 2: Typecheck + lint.**

Run: `bun run check-types && bun run lint`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/src/app/+native-intent.ts
git commit -m "feat(mobile): route siriusapp://capture deep link to /capture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Phase-1 integration check (deep-link simulation, no native build)

**Files:** none (verification only).

- [ ] **Step 1: Boot the existing dev client** in the Simulator and sign in (dev login: `saleebmina@icloud.com` + `DEV_LOGIN_PASSWORD` from `.env`).

- [ ] **Step 2: Fire the deep link directly** (this is the exact URL the Swift intent will produce):

Run: `xcrun simctl openurl booted "siriusapp://capture?text=Check%20this%20https%3A%2F%2Fexample.com"`
Expected: Sirius foregrounds to the `/capture` screen showing **two** rows — a `url` (example.com) and a `note` ("Check this").

- [ ] **Step 3: Note-only link.**

Run: `xcrun simctl openurl booted "siriusapp://capture?text=Remember%20to%20read%20this%20later"`
Expected: `/capture` shows one `note` row. Tapping **Queue it** lands the submission and navigates to the Queue tab; a new row appears there.

- [ ] **Step 4: Empty payload.**

Run: `xcrun simctl openurl booted "siriusapp://capture?text="`
Expected: the "Nothing to capture" empty state (no junk submitted).

- [ ] **Step 5: Release Phase-1 reservations & re-check inbox.**

```
release_file_reservations(project_key="/Users/minasaleeb/workspaces/sirius-2-simple", agent_name="StormyMeadow")
fetch_inbox(project_key="/Users/minasaleeb/workspaces/sirius-2-simple", agent_name="StormyMeadow")
```

> If Step 2/3 don't route to `/capture`, the issue is the `+native-intent` base-path matching for custom schemes — log the actual `path` string and adjust the matcher before moving to Phase 2.

---

# Phase 2 — Native config plugin + Swift App Intents

**Why second:** Phase 1 proved the JS path. Phase 2 only adds the native surface that emits the deep link. This phase REQUIRES a fresh `expo prebuild` + EAS dev/preview build (Expo Go cannot carry App Intents).

### Phase 2 reservation (do before Task 6)

```
file_reservation_paths(
  project_key="/Users/minasaleeb/workspaces/sirius-2-simple",
  agent_name="StormyMeadow",
  paths=[
    "apps/mobile/app.json",
    "apps/mobile/plugins/with-capture-intents.js",
    "apps/mobile/ios-intents/CaptureInSiriusIntent.swift",
    "apps/mobile/ios-intents/SiriusShortcuts.swift"
  ],
  ttl_seconds=5400, exclusive=true, reason="shortcuts app-intents phase 2 (native)"
)
```
`app.json` is a hot coordination file — reserve immediately before editing and release right after the Phase-2 commit; do not hold it across the build.

---

### Task 6: Write the Swift App Intent sources

**Files:**
- Create: `apps/mobile/ios-intents/CaptureInSiriusIntent.swift`
- Create: `apps/mobile/ios-intents/SiriusShortcuts.swift`

**Interfaces:**
- Produces: a `CaptureInSiriusIntent` that opens `siriusapp://capture?text=<percent-encoded>`, and a `SiriusShortcuts` provider exposing the phrase.

- [ ] **Step 1: `CaptureInSiriusIntent.swift`:**

```swift
import AppIntents
import UIKit

@available(iOS 16.0, *)
struct CaptureInSiriusIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture in Sirius"
    static var description = IntentDescription(
        "Send a note or link to your Sirius capture queue."
    )

    // Open the app so the existing authenticated session performs the submit.
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Text", description: "A note or link to capture.")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        let encoded = text.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? ""
        if let url = URL(string: "siriusapp://capture?text=\(encoded)") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}
```

- [ ] **Step 2: `SiriusShortcuts.swift`:**

```swift
import AppIntents

@available(iOS 16.0, *)
struct SiriusShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureInSiriusIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Capture this in \(.applicationName)",
                "New capture in \(.applicationName)"
            ],
            shortTitle: "Capture in Sirius",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
```

- [ ] **Step 3: Commit (sources only; not wired yet).**

```bash
git add apps/mobile/ios-intents/CaptureInSiriusIntent.swift apps/mobile/ios-intents/SiriusShortcuts.swift
git commit -m "feat(mobile): Swift App Intent sources for Capture in Sirius

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Write the `with-capture-intents` config plugin

**Files:**
- Create: `apps/mobile/plugins/with-capture-intents.js`

**Interfaces:**
- Produces: a default-exported config plugin that (a) copies the `ios-intents/*.swift` into `ios/<AppName>/` during prebuild, and (b) adds them to the main target's Sources build phase. Idempotent.
- Consumes: `@expo/config-plugins` (`withDangerousMod`, `withXcodeProject`).

- [ ] **Step 1: Write the plugin:**

```js
const {
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SWIFT_FILES = ["CaptureInSiriusIntent.swift", "SiriusShortcuts.swift"];

// Copy the App Intent Swift sources into the prebuilt iOS app target and
// register them in the Sources build phase. ios/ is gitignored and regenerated
// by `expo prebuild`, so this must run on every prebuild.
const withCaptureIntents = (config) => {
  // (a) Copy sources into ios/<AppName>/
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } =
        cfg.modRequest;
      const srcDir = path.join(projectRoot, "ios-intents");
      const destDir = path.join(platformProjectRoot, projectName);
      for (const file of SWIFT_FILES) {
        const from = path.join(srcDir, file);
        const to = path.join(destDir, file);
        fs.copyFileSync(from, to);
      }
      return cfg;
    },
  ]);

  // (b) Add the sources to the main target's Sources build phase.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const groupKey =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject().firstProject.mainGroup;
    const target = project.getFirstTarget().uuid;
    for (const file of SWIFT_FILES) {
      const projectPath = `${appName}/${file}`;
      if (!project.hasFile(projectPath)) {
        project.addSourceFile(projectPath, { target }, groupKey);
      }
    }
    return cfg;
  });

  return config;
};

module.exports = withCaptureIntents;
```

- [ ] **Step 2: Lint the plugin file.**

Run: `bun run lint`
Expected: PASS (the plugin is plain CommonJS Node — confirm it isn't tripped by the mobile ESLint config; if `plugins/` is outside the lint glob this is a no-op, which is fine).

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/plugins/with-capture-intents.js
git commit -m "feat(mobile): config plugin to inject App Intents into iOS target

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Register the plugin in `app.json`

**Files:**
- Modify: `apps/mobile/app.json` (append to `expo.plugins[]`)

- [ ] **Step 1: Add the local plugin to the `plugins` array** (after `"expo-sqlite"`, keeping existing entries unchanged):

```json
      "expo-background-task",
      "expo-sqlite",
      "./plugins/with-capture-intents"
```

- [ ] **Step 2: Validate JSON + typecheck.**

Run: `bun run check-types`
Expected: PASS (and `app.json` remains valid JSON).

- [ ] **Step 3: Commit.**

```bash
git add apps/mobile/app.json
git commit -m "feat(mobile): register with-capture-intents config plugin

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Release Phase-2 reservations & re-check inbox.**

```
release_file_reservations(project_key="/Users/minasaleeb/workspaces/sirius-2-simple", agent_name="StormyMeadow")
fetch_inbox(project_key="/Users/minasaleeb/workspaces/sirius-2-simple", agent_name="StormyMeadow")
```

---

### Task 9: Prebuild sanity check (native wiring)

**Files:** none (verification only).

- [ ] **Step 1: Clean prebuild.**

Run: `bun --cwd apps/mobile expo prebuild --platform ios --clean`
Expected: completes without error.

- [ ] **Step 2: Confirm the Swift landed in the target.**

Run: `ls apps/mobile/ios/Sirius/CaptureInSiriusIntent.swift apps/mobile/ios/Sirius/SiriusShortcuts.swift`
Expected: both files exist.

Then open `apps/mobile/ios/Sirius.xcodeproj/project.pbxproj` and confirm both filenames appear in a `PBXSourcesBuildPhase` block (i.e. they're compiled, not just present on disk). If they're missing from Sources, the `addSourceFile` group/target wiring in Task 7 needs adjustment before building.

> Confirm the app's iOS deployment target is ≥ 16.0 (check `apps/mobile/ios/Podfile` / project settings). If it's lower, the `AppShortcutsProvider` simply won't surface; bump the deployment target or accept iOS-16+-only availability. Flag to the human if a bump is needed.

---

# Phase 3 — Build, manual verification, handoff

### Task 10: Dev-client build + on-device verification

**Files:** none (build + manual test).

- [ ] **Step 1: Build a dev client** (Expo Go cannot carry this):

Run: `bun run mobile:build:dev:ios`  (EAS `--profile development --platform ios`)
Expected: EAS build succeeds. `bun run verify:native-ai` (run by the build hook) still passes — this change doesn't touch llama.rn.

- [ ] **Step 2: Install the dev client** on the Simulator/device and sign in.

- [ ] **Step 3–6: Manual test matrix** — see "How to test manually" below; run all four cases.

- [ ] **Step 7: Final coordination message** to HazySnow summarizing what shipped + the touched paths, then release any remaining reservations.

```
send_message(... to=["HazySnow"], subject="[done] Shortcuts App Intents capture shipped", ...)
release_file_reservations(project_key="/Users/minasaleeb/workspaces/sirius-2-simple", agent_name="StormyMeadow")
```

---

## How to test manually (once finished)

**Phase 1 (no rebuild — fastest feedback), against the current dev client:**

1. Boot the Simulator, open Sirius, sign in.
2. `xcrun simctl openurl booted "siriusapp://capture?text=Check%20this%20https%3A%2F%2Fexample.com"`
   → Sirius opens to **Capture in Sirius → Queue this** with two rows (a link + a note). Tap **Queue it** → lands in the **Queue** tab.
3. `xcrun simctl openurl booted "siriusapp://capture?text=Remember%20to%20read%20later"` → one note row.
4. `xcrun simctl openurl booted "siriusapp://capture?text="` → "Nothing to capture" empty state.
5. Sign out, repeat step 2 → routes to the **Sign in** gate (payload not lost on re-run).

**Phase 2/3 (the real Shortcuts integration — needs the dev-client build from Task 10):**

1. **Shortcuts app:** open it → tap **+** → **Add Action** → search "Sirius" → the **Capture in Sirius** action appears. Add it, type some text (include a URL), run it → Sirius opens to the confirm screen → **Queue it** → row appears in Queue.
2. **Siri:** say "Hey Siri, Capture in Sirius" → Siri prompts for the text → speak/type it → app opens to confirm → queue it.
3. **Spotlight/Shortcuts gallery:** the action should also be searchable as a shortcut suggestion shortly after install.
4. **Signed-out:** sign out, run the shortcut → app opens to the Sign-in gate; after signing in, re-running the shortcut completes the capture.

Report back: (a) does the action show in the Shortcuts app, (b) does running it open `/capture` pre-filled, (c) does **Queue it** create a Queue row, (d) does the Siri phrase work. If the action never appears in Shortcuts, the cause is almost always the Swift not compiled into the main target (re-check Task 9 Step 2) or an iOS-target < 16.

---

## Self-Review

- **Spec coverage:** config plugin (Task 7) ✓; main-target injection (Task 7/9) ✓; `CaptureInSiriusIntent` + `openAppWhenRun` + percent-encoded deep link (Task 6) ✓; `AppShortcutsProvider` phrase (Task 6) ✓; `+native-intent` routing (Task 4) ✓; `/capture` screen + `materialsFromText` + `submitMaterials` + session reuse (Tasks 1–3) ✓; signed-out gate (Task 3) ✓; empty-text state (Task 3) ✓; text-only/out-of-scope images (no image row in `/capture`) ✓; iOS 16 gating + deployment-target check (Task 6/9) ✓; verification incl. manual matrix ✓; reservations + explicit-path commits per phase ✓.
- **Placeholder scan:** no TBD/TODO; all code blocks complete.
- **Type consistency:** `materialsFromText(text: string): Material[]` and `applyNote(materials, note)` used identically in Tasks 1–3; `submitMaterials(materials, { force: false })` matches the real signature; `useLocalSearchParams<{ text?: string }>()` matches the `text` query param emitted by the Swift intent and normalized by `+native-intent`.
- **Known fiddly point (flagged, not a placeholder):** the `xcode` pbxproj `addSourceFile`/group/target wiring (Task 7) is verified empirically in Task 9 Step 2 before any build depends on it.
