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
          title="How Lesswhelmed works"
          titleAccent="."
          subtitle="You barely have to open this app. Share things to Lesswhelmed from anywhere — we turn them into posts for you."
        />

        {/* 1 — The Share Sheet move (hero) */}
        <View style={styles.section}>
          <Eyebrow accessibilityRole="header">The one move to learn</Eyebrow>
          <Text style={styles.sectionLead}>
            See something worth keeping? Send it straight to Lesswhelmed without
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
                // Decorative — the "Pick Sirius" title/body carry the meaning,
                // so keep VoiceOver from announcing an unlabeled image.
                accessible={false}
              />
            }
            title="Pick Lesswhelmed"
            body="Choose Lesswhelmed from the share row. That's it — we take it from there."
          />
          <Text style={styles.note}>
            Don&apos;t see Lesswhelmed in the row? Scroll to the end, tap More (or
            Edit), and switch Lesswhelmed on. You only do this once.
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
            title="Lesswhelmed drafts it"
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
