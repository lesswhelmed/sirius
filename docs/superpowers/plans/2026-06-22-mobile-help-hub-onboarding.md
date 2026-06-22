# Mobile Help Hub / First-Run Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single themed "How Sirius works" help hub at `/help` that teaches the native Share Sheet move, doubles as a once-only first-run onboarding deep-link, and is reachable on demand from the Capture and Account tabs.

**Architecture:** One scrollable modal screen (`src/app/help.tsx`) built from the existing `@/components/sirius` primitives and the `useThemedStyles` theme contract. A per-device `expo-secure-store` boolean (`src/lib/onboarding.ts`) gates a one-time redirect from the app entry (`src/app/index.tsx`) into `/help`. Two permanent entry points (Capture header link, Account row) push the same route.

**Tech Stack:** Expo Router (file-based routing, modal presentation), React Native, `expo-secure-store`, `expo-symbols` (SF Symbols with glyph fallback), the app's token-driven theme (`@/constants/theme` + `@/constants/theme-context`).

## Global Constraints

- **Mobile only.** No web/marketing/server changes. No Prisma schema change, no new dependency.
- **Theming is mandatory and tokenized.** Every screen reads colors/space/fonts through `useThemedStyles(makeStyles)` + `useTheme()` from `@/constants/theme-context`. NEVER read theme tokens at module scope inside `StyleSheet.create` (it snapshots one theme and won't switch — see `theme.ts` header). All text colors must use AA-clearing tokens (`ink`, `inkMuted`, `inkSubtle`, `markText`); `inkFaint` is decorative only, never text. Contract: `docs/THEMING.md`.
- **SF Symbols need a fallback.** Use `SymbolView` from `expo-symbols` with a `fallback` prop (text glyph or `<></>`) — Android/web have no SF Symbols. Symbol names are typed via `sf-symbols-typescript`.
- **No test runner exists** (per `CLAUDE.md` — `scripts/testing/` is not wired into package.json). Do NOT write or claim automated tests. The per-task automated gate is `bun run check-types` + `bun run lint` (both run turbo). Behavior is verified manually in the iOS Simulator (steps given per task). This adapts the skill's default TDD loop to the project's reality, per instruction priority (CLAUDE.md > skill).
- **If types don't resolve**, run `bun run db:generate` once first (the generated Prisma client is gitignored and required across the workspace graph — per `CLAUDE.md`).
- **Swarm-safe commits.** This repo runs a multi-agent swarm on `main`. Commit ONLY the explicit file paths listed in each task's commit step. NEVER `git add -A`.
- **Commit message footer.** End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## File Structure

- **Create `apps/mobile/src/lib/onboarding.ts`** — per-device first-run flag (get/set), backed by `expo-secure-store`. One responsibility: "has the user seen onboarding on this device?"
- **Create `apps/mobile/src/app/help.tsx`** — the Help hub screen + its local presentational sub-components (`StepCard`, `ShareList`). One responsibility: render the three teaching sections + close.
- **Modify `apps/mobile/src/app/_layout.tsx`** — register `help` as a modal screen in the root `Stack`.
- **Modify `apps/mobile/src/app/index.tsx`** — first-run redirect logic using the flag.
- **Modify `apps/mobile/src/app/(tabs)/composer.tsx`** — add a "How it works →" link to the Capture header toolbar.
- **Modify `apps/mobile/src/app/(tabs)/settings.tsx`** — add a "How Sirius works" row in a new Help section.

**Deferred-decision resolutions (made for best UX):**
- The "nudge" lives as a persistent `TextLink` in the **Capture header toolbar** (always visible on the primary action surface, matching the existing "Manage focus →" link) rather than an empty-only state — the composer has no true empty state, it always shows the action grid. Plus the permanent Account row. Catalog empty state already points users to Capture, so no third surface is added (DRY).
- The flag helper is its **own focused file** (`src/lib/onboarding.ts`), not folded into `persist.ts` — `persist.ts` is specifically per-user keyed string-sets; this is a single per-device boolean.

---

### Task 1: Onboarding flag helper

**Files:**
- Create: `apps/mobile/src/lib/onboarding.ts`

**Interfaces:**
- Consumes: `expo-secure-store` (already a dependency — used by `src/lib/persist.ts` and `src/lib/auth-client.ts`).
- Produces:
  - `hasSeenOnboarding(): Promise<boolean>` — `true` if the first-run hub has already been shown on this device. Returns `true` on any read error (fail-safe: never trap the user on onboarding).
  - `markOnboardingSeen(): Promise<void>` — records that it has been shown; best-effort (swallows write errors).

- [ ] **Step 1: Create the helper**

Create `apps/mobile/src/lib/onboarding.ts`:

```ts
// Per-DEVICE first-run flag for the "How Sirius works" hub (src/app/help.tsx).
// Backed by expo-secure-store (already used by auth-client.ts / persist.ts) so
// it persists across relaunches and reinstalls-of-JS without a schema change.
//
// Per-device, not per-account: re-logging in on a device that has already seen
// the hub must NOT replay onboarding. The whole point is "show it once".
import * as SecureStore from "expo-secure-store";

const KEY = "sirius.onboarding.seen";

/**
 * Whether the first-run hub has already been shown on this device.
 * On ANY read failure we return `true` (treat as seen) — a storage error must
 * never trap the user on the onboarding screen at every launch.
 */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === "1";
  } catch {
    return true;
  }
}

/** Record that the first-run hub has been shown. Best-effort: a write failure
 *  must never break launch (worst case the hub shows once more). */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, "1");
  } catch {
    // ignore — see note above
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run check-types`
Expected: PASS (no errors). If types fail to resolve at all, run `bun run db:generate` first, then re-run.

- [ ] **Step 3: Lint**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run lint`
Expected: PASS (0 warnings — apps lint with `--max-warnings 0`).

- [ ] **Step 4: Commit**

```bash
cd /Users/minasaleeb/workspaces/sirius-2-simple
git add apps/mobile/src/lib/onboarding.ts
git commit -m "feat(mobile): per-device onboarding-seen flag helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The Help hub screen + modal registration

**Files:**
- Create: `apps/mobile/src/app/help.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (register `help` modal after the `capture` screen, around lines 208–211)

**Interfaces:**
- Consumes: `Screen`, `PageHeader`, `Eyebrow`, `PrimaryButton` from `@/components/sirius`; `useTheme`, `useThemedStyles` from `@/constants/theme-context`; `type Theme` from `@/constants/theme`; `CAPTURE_KINDS`, `type CaptureKindKey` from `@/lib/material-kinds`; `SymbolView` from `expo-symbols`; `Image` from `expo-image`; `router` from `expo-router`.
- Produces: a default-exported `HelpScreen` route component reachable at `/help`. Close behavior: `router.canGoBack() ? router.back() : router.replace("/(tabs)/library")` (handles both modal-push and first-run-redirect entry — the redirect from `index.tsx` may leave no back stack).

- [ ] **Step 1: Create the Help screen**

Create `apps/mobile/src/app/help.tsx`:

```tsx
// The "How Sirius works" hub — the app's only onboarding/help surface.
//
// Double duty (see docs/superpowers/specs/2026-06-22-mobile-help-hub-onboarding-design.md):
//  - first-run: index.tsx deep-links here ONCE (gated by src/lib/onboarding.ts)
//  - on demand: pushed from the Capture header link and the Account "How Sirius
//    works" row, any time after.
//
// Three sections, ordered by importance:
//  1. The Share Sheet move (hero) — the "you barely need to open this app" pitch
//  2. What you can share          — canonical CAPTURE_KINDS labels + examples
//  3. What happens after you share — the hands-off pipeline (Queue -> Catalog)
import { Image } from "expo-image";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

import { Eyebrow, PageHeader, PrimaryButton, Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { CAPTURE_KINDS, type CaptureKindKey } from "@/lib/material-kinds";

// Plain-language example for each capture kind, keyed by the canonical
// CaptureKindKey so the labels/symbols stay sourced from material-kinds.ts.
const SHARE_EXAMPLES: Record<CaptureKindKey, string> = {
  link: "A post on X, an Instagram reel, a YouTube video, any web page",
  repo: "A GitHub repository you want to remember",
  note: "A quick thought, typed or dictated",
  photos: "One photo or a whole set — they become one entry",
  video: "A clip from your library or a fresh recording",
  document: "A PDF or Word doc",
  audio: "A voice memo — we transcribe it for you",
};

function closeHelp() {
  // Modal-push entry has a back stack; the first-run redirect from index.tsx may
  // not — fall back to the tabs so the button always lands somewhere sane.
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(tabs)/library");
  }
}

export default function HelpScreen() {
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          brandMark
          eyebrow="Welcome"
          title="How Sirius works"
          titleAccent="."
          subtitle="You barely have to open this app. Share things to Sirius from anywhere — we turn them into posts for you."
        />

        {/* 1 — The Share Sheet move (hero) */}
        <View style={styles.section}>
          <Eyebrow accessibilityRole="header">The one move to learn</Eyebrow>
          <Text style={styles.sectionLead}>
            See something worth keeping? Send it straight to Sirius without
            opening the app:
          </Text>
          <StepCard
            n={1}
            icon={<Sym name="apps.iphone" glyph="▦" />}
            title="Open anything"
            body="A post on X, a Safari page, a photo, a voice memo, a PDF — whatever you want to keep."
          />
          <StepCard
            n={2}
            icon={<Sym name="square.and.arrow.up" glyph="↑" />}
            title="Tap Share"
            body="The same Share button you'd use to send something to a friend."
          />
          <StepCard
            n={3}
            icon={
              <Image
                source={require("@/assets/images/icon.png")}
                style={styles.stepBrand}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            }
            title="Pick Sirius"
            body="Choose Sirius from the share row. That's it — we take it from there."
          />
          <Text style={styles.note}>
            Don't see Sirius in the row? Scroll to the end, tap More (or Edit),
            and switch Sirius on. You only do this once.
          </Text>
        </View>

        {/* 2 — What you can share */}
        <View style={styles.section}>
          <Eyebrow accessibilityRole="header">What you can share</Eyebrow>
          {CAPTURE_KINDS.map((kind) => (
            <ShareRow
              key={kind.key}
              symbol={kind.symbol}
              glyph={kind.glyph}
              label={kind.label}
              example={SHARE_EXAMPLES[kind.key]}
            />
          ))}
          <Text style={styles.note}>…and more on the way.</Text>
        </View>

        {/* 3 — What happens after you share */}
        <View style={styles.section}>
          <Eyebrow accessibilityRole="header">What happens next</Eyebrow>
          <StepCard
            n={1}
            icon={<Sym name="sparkles" glyph="✦" />}
            title="Sirius drafts it"
            body="We read what you shared and write it up as a post — a finding, a sight, or a note."
          />
          <StepCard
            n={2}
            icon={<Sym name="tray.full" glyph="▤" />}
            title="Watch it in Queue"
            body="While we work, it shows up on your Queue tab. No need to wait around."
          />
          <StepCard
            n={3}
            icon={<Sym name="books.vertical" glyph="❏" />}
            title="Find it in your Catalog"
            body="When it's ready it lands in your Catalog, yours to read, edit, or share."
          />
        </View>

        <PrimaryButton label="Got it" onPress={closeHelp} />
      </ScrollView>
    </Screen>
  );
}

// An SF Symbol in the accent tone with a text-glyph fallback for Android/web.
function Sym({ name, glyph }: { name: SFSymbol; glyph: string }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <SymbolView
      name={name}
      size={24}
      weight="regular"
      tintColor={t.color.accent}
      fallback={<Text style={styles.glyphFallback}>{glyph}</Text>}
    />
  );
}

// A numbered teaching card: badge + icon + title + body.
function StepCard({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepCard}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <View style={styles.stepIcon}>{icon}</View>
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </View>
  );
}

// One row in "What you can share": symbol + label + example.
function ShareRow({
  symbol,
  glyph,
  label,
  example,
}: {
  symbol: SFSymbol;
  glyph: string;
  label: string;
  example: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.shareRow}>
      <View style={styles.shareIcon}>
        <Sym name={symbol} glyph={glyph} />
      </View>
      <View style={styles.stepText}>
        <Text style={styles.stepTitle}>{label}</Text>
        <Text style={styles.stepBody}>{example}</Text>
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.xl,
      paddingBottom: 80,
      gap: t.space.xl,
    },
    section: { gap: t.space.md },
    sectionLead: {
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 24,
      color: t.color.inkMuted,
    },
    note: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 19,
      color: t.color.inkSubtle,
    },
    glyphFallback: {
      fontSize: 22,
      lineHeight: 26,
      color: t.color.accent,
      fontFamily: t.font.serif,
    },
    stepCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      paddingVertical: t.space.md,
      paddingHorizontal: t.space.md,
    },
    stepBadge: {
      width: 28,
      height: 28,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    stepBadgeText: {
      fontFamily: t.font.mono,
      fontSize: 13,
      fontWeight: "700",
      color: t.color.accent,
    },
    stepIcon: { width: 28, alignItems: "center", justifyContent: "center" },
    stepBrand: { width: 26, height: 26, borderRadius: 6 },
    stepText: { flex: 1, gap: 3 },
    stepTitle: {
      fontFamily: t.font.serif,
      fontSize: 17,
      color: t.color.ink,
    },
    stepBody: {
      fontFamily: t.font.sans,
      fontSize: 14,
      lineHeight: 20,
      color: t.color.inkMuted,
    },
    shareRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
      paddingVertical: t.space.xs,
    },
    shareIcon: { width: 28, alignItems: "center", justifyContent: "center" },
  });
}
```

- [ ] **Step 2: Register the route as a modal**

In `apps/mobile/src/app/_layout.tsx`, add a `help` screen immediately after the existing `capture` screen (currently around lines 208–211). The block to find:

```tsx
                  <Stack.Screen
                    name="capture"
                    options={{ presentation: "modal" }}
                  />
```

Add directly after it:

```tsx
                  <Stack.Screen
                    name="help"
                    options={{ presentation: "modal" }}
                  />
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run check-types`
Expected: PASS. (If `SymbolView` rejects a symbol name, swap to a valid `sf-symbols-typescript` name — the typecheck enforces validity.)

- [ ] **Step 4: Lint**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run lint`
Expected: PASS (0 warnings).

- [ ] **Step 5: Manual verification (iOS Simulator)**

Run the app (`bun --cwd apps/mobile ios`, or full `bun run dev`). Temporarily reach the screen by adding it to a URL or tapping an entry added in Task 4 — but at minimum, deep-link `siriusapp:///help` is NOT wired; instead verify after Task 4. For this task, confirm it **compiles and the file renders** by navigating via the Expo Router dev menu or deferring visual check to Task 4. Note in your report that visual verification is bundled into Task 4's checklist.

- [ ] **Step 6: Commit**

```bash
cd /Users/minasaleeb/workspaces/sirius-2-simple
git add apps/mobile/src/app/help.tsx apps/mobile/src/app/_layout.tsx
git commit -m "feat(mobile): add How Sirius works help hub at /help

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: First-run redirect into the hub

**Files:**
- Modify: `apps/mobile/src/app/index.tsx` (full rewrite of the 21-line file)

**Interfaces:**
- Consumes: `useSession` from `@/lib/auth-client`; `hasSeenOnboarding`, `markOnboardingSeen` from `@/lib/onboarding` (Task 1); the `/help` route (Task 2).
- Produces: unchanged public contract — still the default-exported `Index` route at `/`. New behavior: an authenticated user who has not seen onboarding on this device is redirected once to `/help` (and the flag is set); everyone else routes as before (`/(tabs)/library` when signed in, `/(auth)/sign-in` otherwise).

- [ ] **Step 1: Rewrite the entry component**

Replace the entire contents of `apps/mobile/src/app/index.tsx` with:

```tsx
import { Redirect } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useSession } from "@/lib/auth-client";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding";

type Dest = "loading" | "signin" | "tabs" | "help";

export default function Index() {
  const { data: session, isPending } = useSession();
  const [dest, setDest] = useState<Dest>("loading");

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      setDest("signin");
      return;
    }
    let active = true;
    void (async () => {
      // Fail-safe to "seen" — hasSeenOnboarding never throws (it returns true
      // on read error), but be explicit so a future change can't trap the user.
      let seen = true;
      try {
        seen = await hasSeenOnboarding();
      } catch {
        seen = true;
      }
      if (!seen) {
        await markOnboardingSeen();
      }
      if (active) setDest(seen ? "tabs" : "help");
    })();
    return () => {
      active = false;
    };
  }, [isPending, session]);

  if (dest === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (dest === "signin") return <Redirect href="/(auth)/sign-in" />;
  if (dest === "help") return <Redirect href="/help" />;
  return <Redirect href="/(tabs)/library" />;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run check-types`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run lint`
Expected: PASS (0 warnings).

- [ ] **Step 4: Commit**

```bash
cd /Users/minasaleeb/workspaces/sirius-2-simple
git add apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): deep-link first launch into the help hub once

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: On-demand entry points (Capture link + Account row) & full manual verification

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/composer.tsx` (header toolbar, around lines 656–670)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (add a Help section before the Sign out section, around line 263)

**Interfaces:**
- Consumes: `router` (already imported in both files), `TextLink` (already imported in `composer.tsx`), `SecondaryButton` (already imported in `settings.tsx`), the `/help` route (Task 2).
- Produces: two new tap targets that `router.push("/help")`.

- [ ] **Step 1: Add the Capture header link**

In `apps/mobile/src/app/(tabs)/composer.tsx`, inside the `headerToolbar` `View`, add a link after the existing "Manage focus →" `TextLink` (and before the `ON_DEVICE_AI_ENABLED` block). The block to find:

```tsx
              <TextLink
                label="Manage focus →"
                tone={t.color.accent}
                onPress={() => router.push("/focus")}
              />
```

Add directly after it:

```tsx
              <TextLink
                label="How it works →"
                tone={t.color.accent}
                onPress={() => router.push("/help")}
              />
```

- [ ] **Step 2: Add the Account Help row**

In `apps/mobile/src/app/(tabs)/settings.tsx`, add a new Help section immediately before the `{/* Sign out */}` section (around line 263). The block to find:

```tsx
        {/* Sign out */}
        <View style={styles.section}>
          <SecondaryButton label="Sign out" onPress={handleSignOut} />
        </View>
```

Insert directly BEFORE it:

```tsx
        {/* Help — the How Sirius works hub (also shown once on first launch). */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Help</Text>
          <SecondaryButton
            label="How Sirius works"
            symbol="questionmark.circle"
            onPress={() => router.push("/help")}
          />
        </View>

```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run check-types`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `cd /Users/minasaleeb/workspaces/sirius-2-simple && bun run lint`
Expected: PASS (0 warnings).

- [ ] **Step 5: Full manual verification (iOS Simulator)**

Hand these exact steps to the user (per the `prefer-user-manual-testing` memory — do NOT drive the simulator with agent-device):

1. **Fresh first run:** Erase the simulator's onboarding flag or use a fresh install (Device → Erase All Content, or delete the app). Launch → sign in. **Expect:** the "How Sirius works" hub appears once.
2. **Read-through:** Verify all three sections render — Share Sheet steps 1–3 (icons + brand mark visible), the "What you can share" list (7 kinds with examples), and "What happens next". Tap **Got it** → lands on the tabs.
3. **No replay:** Force-quit and relaunch → goes straight to the tabs (no hub).
4. **On-demand (Account):** Account tab → "How Sirius works" row → hub opens as a modal → close returns to Account.
5. **On-demand (Capture):** Capture tab → "How it works →" in the header → hub opens → close returns to Capture.
6. **Theme:** Toggle iOS appearance (light ⇄ dark) while on the hub → all text stays legible, accent/brand colors adapt (cream/oxblood in light, navy/sage-gold in dark).

- [ ] **Step 6: Commit**

```bash
cd /Users/minasaleeb/workspaces/sirius-2-simple
git add "apps/mobile/src/app/(tabs)/composer.tsx" "apps/mobile/src/app/(tabs)/settings.tsx"
git commit -m "feat(mobile): add help-hub entry points to Capture and Account

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- "Single scrollable themed Help hub at `/help`" → Task 2.
- "Three content sections (hero / what you can share / what happens after)" → Task 2 (all three present).
- "Hero = themed numbered steps + icons" → Task 2 `StepCard` + `Sym` with brand mark for step 3.
- "What you can share rendered from canonical CAPTURE_KINDS" → Task 2 maps `CAPTURE_KINDS`, examples keyed by `CaptureKindKey`.
- "Per-device SecureStore flag `sirius.onboarding.seen`" → Task 1.
- "First-run deep-link once from index.tsx; fall through to tabs on error" → Task 3.
- "On-demand entry: Account row + nudge" → Task 4 (Account row + Capture header link; rationale for placement documented above).
- "Edge case: SecureStore failure never wedges launch" → Task 1 (`hasSeenOnboarding` returns `true` on error) + Task 3 (explicit fail-safe).
- "Modal registration mirroring shareintent/capture" → Task 2 Step 2.
- "Theming contract / AA / SF-symbol fallback" → Global Constraints + applied throughout Task 2.
- "No share-sheet detection; teach only" → no detection code anywhere; hero is static teaching content. ✓
- Non-goals (no web copy, no carousel, no power-tips, no analytics, no server state) → none introduced. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step is complete and copy-paste-ready. The one soft spot (Task 2 Step 5 visual check) is explicitly deferred to Task 4 Step 5, not left vague.

**Type consistency:** `hasSeenOnboarding`/`markOnboardingSeen` signatures match between Task 1 (definition) and Task 3 (use). `CaptureKindKey` import (Task 2) matches its export in `material-kinds.ts` (verified). `closeHelp` uses `router.replace("/(tabs)/library")` — same route used by `index.tsx`. `Sym`/`StepCard`/`ShareRow` are defined and used within the same file (Task 2). The `help` route name in `_layout.tsx` matches the `help.tsx` filename and all `router.push("/help")` callers.
