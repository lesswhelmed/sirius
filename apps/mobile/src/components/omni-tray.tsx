// Omni-ingest tray components for the Capture tab. These are THIN host views —
// all classification, validation, override-legality, and dedup logic comes from
// the shared @repo/ingest-classify package; the only state these render is
// derived in @/lib/omni-ingest (consolidation + the uri registry). Rust-red
// (theme `error`) is used EXCLUSIVELY for validation errors here, never as an
// action color.
import {
  canOverride,
  type ClassifiedItem,
  type IngestKind,
  type InlineError,
  OVERRIDE_MATRIX,
} from "@repo/ingest-classify";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { type ReactNode } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Eyebrow, KindLabel } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import {
  type ErrorSummary,
  markerLabel,
  type RnAsset,
} from "@/lib/omni-ingest";

// Cosmetic platform pill copy for url cards.
const PLATFORM_PILL: Record<string, string> = {
  repository: "Repository",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  link: "Link",
};

// Human label for an override target kind in the action sheet.
const KIND_LABEL: Record<IngestKind, string> = {
  url: "Link",
  note: "Note",
  image: "Photo",
  video: "Video",
  audio: "Audio",
  document: "Document",
};

// ── TrayErrorSummary ─────────────────────────────────────────────────────────
// The single tray-level collapsed line(s) when ≥3 cards share a code (§4). NOT a
// global banner — it's contextual to the tray and clears as cards are fixed.
export function TrayErrorSummary({ summaries }: { summaries: ErrorSummary[] }) {
  const styles = useThemedStyles(makeStyles);
  if (summaries.length === 0) return null;
  return (
    <View style={styles.summaryWrap}>
      {summaries.map((s) => (
        <View
          key={s.code}
          style={[
            styles.summaryRow,
            s.severity === "critical"
              ? styles.summaryRowCritical
              : styles.summaryRowWarn,
          ]}
          accessibilityRole="alert"
        >
          <Text
            style={[
              styles.summaryText,
              s.severity === "critical"
                ? styles.summaryTextCritical
                : styles.summaryTextWarn,
            ]}
          >
            {s.message}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── InlineCardError ──────────────────────────────────────────────────────────
// One card's error(s) inline (rust-red). When the tray-level collapse is active
// for a code, renders the subtle marker form instead of the full sentence (§4).
function InlineCardError({
  errors,
  collapsedCodes,
}: {
  errors: InlineError[];
  collapsedCodes: Set<InlineError["code"]>;
}) {
  const styles = useThemedStyles(makeStyles);
  if (errors.length === 0) return null;
  return (
    <View style={styles.errorWrap}>
      {errors.map((e, i) => {
        const collapsed = collapsedCodes.has(e.code);
        const isCritical = e.severity === "critical";
        return (
          <View
            key={`${e.code}-${i}`}
            style={[
              styles.errorRow,
              isCritical ? styles.errorRowCritical : styles.errorRowWarn,
            ]}
            // role=alert (assertive) so a screen reader announces the blocking
            // problem immediately; warn errors stay informative but non-blocking.
            accessibilityRole="alert"
          >
            <Text
              style={[
                styles.errorText,
                isCritical ? styles.errorTextCritical : styles.errorTextWarn,
              ]}
            >
              {collapsed ? markerLabel(e.code) : e.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── KindOverrideMenu trigger ─────────────────────────────────────────────────
// Subtle ⌄ control. Lists ONLY the legal target kinds for this card's current
// kind (from canOverride / OVERRIDE_MATRIX). Hidden when no legal target exists.
function presentOverrideMenu(
  from: IngestKind,
  onSelect: (to: IngestKind) => void,
) {
  const targets = OVERRIDE_MATRIX[from].filter((to) => canOverride(from, to));
  if (targets.length === 0) return;
  if (Platform.OS === "ios") {
    const options = [...targets.map((k) => KIND_LABEL[k]), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Change type",
        options,
        cancelButtonIndex: options.length - 1,
      },
      (index) => {
        if (index >= 0 && index < targets.length) onSelect(targets[index]!);
      },
    );
  } else {
    Alert.alert("Change type", undefined, [
      ...targets.map((k) => ({
        text: KIND_LABEL[k],
        onPress: () => onSelect(k),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }
}

// ── SmartCard ────────────────────────────────────────────────────────────────
export function SmartCard({
  item,
  errors,
  collapsedCodes,
  thumbUri,
  sightBadge,
  onEdit,
  onOverride,
  onRemove,
  disabled,
}: {
  item: ClassifiedItem;
  errors: InlineError[];
  collapsedCodes: Set<InlineError["code"]>;
  // Image preview uri (image cards only).
  thumbUri?: string;
  // True for the FIRST card of a SIGHT photo group → renders the "1 SIGHT" badge.
  sightBadge?: boolean;
  // Inline edit: url/note cards edit content; file cards edit their optional note.
  onEdit: () => void;
  onOverride: (to: IngestKind) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const hasCritical = errors.some((e) => e.severity === "critical");
  const overridable = OVERRIDE_MATRIX[item.kind].some((to) =>
    canOverride(item.kind, to),
  );
  const platformPill =
    item.kind === "url" && item.platform
      ? PLATFORM_PILL[item.platform]
      : undefined;

  return (
    <View
      style={[
        styles.card,
        hasCritical && styles.cardError,
        disabled && styles.cardDisabled,
      ]}
    >
      <View style={styles.cardMain}>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.thumb}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        <View style={styles.cardText}>
          <View style={styles.tagRow}>
            <KindLabel tone={t.color.accent}>{item.displayTag}</KindLabel>
            {platformPill ? (
              <View style={styles.platformPill}>
                <Text style={styles.platformPillText}>{platformPill}</Text>
              </View>
            ) : null}
            {sightBadge ? (
              <View style={styles.sightBadge}>
                <Text style={styles.sightBadgeText}>1 SIGHT</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.cardContent} numberOfLines={2}>
            {item.content}
          </Text>
          <InlineCardError errors={errors} collapsedCodes={collapsedCodes} />
        </View>
        <View style={styles.cardActions}>
          <CardIconButton
            label={`Edit ${item.displayTag.toLowerCase()}`}
            glyph="✎"
            symbol="square.and.pencil"
            onPress={onEdit}
            disabled={disabled}
          />
          {overridable ? (
            <CardIconButton
              label={`Change ${item.displayTag.toLowerCase()} type`}
              glyph="⌄"
              symbol="arrow.triangle.2.circlepath"
              onPress={() => presentOverrideMenu(item.kind, onOverride)}
              disabled={disabled}
            />
          ) : null}
          <CardIconButton
            label={`Remove ${item.displayTag.toLowerCase()}`}
            glyph="×"
            symbol="xmark"
            onPress={onRemove}
            disabled={disabled}
          />
        </View>
      </View>
    </View>
  );
}

function CardIconButton({
  label,
  glyph,
  symbol,
  onPress,
  disabled,
}: {
  label: string;
  glyph: string;
  symbol: Parameters<typeof SymbolView>[0]["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && styles.iconButtonPressed,
        disabled && styles.iconButtonDisabled,
      ]}
    >
      <SymbolView
        name={symbol}
        size={16}
        weight="regular"
        tintColor={t.color.inkMuted}
        fallback={<Text style={styles.iconGlyph}>{glyph}</Text>}
      />
    </Pressable>
  );
}

// ── Tray header (count + "N to fix") ─────────────────────────────────────────
export function TrayHeader({
  count,
  toFix,
  liveLabel,
}: {
  count: number;
  toFix: number;
  liveLabel: string;
}): ReactNode {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.trayHeader}>
      <Eyebrow>In tray</Eyebrow>
      <View style={styles.trayHeaderRight}>
        {toFix > 0 ? (
          <Text style={styles.toFix}>
            {toFix} to fix
          </Text>
        ) : null}
        <Eyebrow accessibilityLiveRegion="polite" accessibilityLabel={liveLabel}>
          {count}
        </Eyebrow>
      </View>
    </View>
  );
}

export type { RnAsset };

function makeStyles(t: Theme) {
  return StyleSheet.create({
    // Summary
    summaryWrap: { gap: t.space.xs },
    summaryRow: {
      borderLeftWidth: 3,
      paddingLeft: t.space.sm,
      paddingVertical: t.space.xs,
    },
    summaryRowCritical: {
      borderLeftColor: t.color.error,
      backgroundColor: t.color.errorSoft,
    },
    summaryRowWarn: {
      borderLeftColor: t.color.inkSubtle,
      backgroundColor: t.color.paperRaised,
    },
    summaryText: { fontFamily: t.font.mono, fontSize: 12, letterSpacing: 0.3 },
    summaryTextCritical: { color: t.color.errorText },
    summaryTextWarn: { color: t.color.inkMuted },

    // Card
    card: {
      borderWidth: 1,
      borderColor: t.color.rule,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      paddingVertical: t.space.sm,
      paddingHorizontal: t.space.md,
    },
    cardError: {
      borderColor: t.color.error,
      borderLeftWidth: 3,
    },
    cardDisabled: { opacity: 0.5 },
    cardMain: { flexDirection: "row", alignItems: "flex-start", gap: t.space.md },
    thumb: {
      width: 40,
      height: 40,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    cardText: { flex: 1, gap: 4 },
    tagRow: { flexDirection: "row", alignItems: "center", gap: t.space.sm, flexWrap: "wrap" },
    platformPill: {
      borderWidth: 1,
      borderColor: t.color.rule,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    platformPillText: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    sightBadge: {
      borderWidth: 1,
      borderColor: t.color.accentRing,
      backgroundColor: t.color.accentSoft,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    sightBadgeText: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    cardContent: {
      fontFamily: t.font.serif,
      fontSize: 15,
      lineHeight: 20,
      color: t.color.ink,
    },
    cardActions: { flexDirection: "row", alignItems: "center", gap: 2 },
    iconButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonPressed: { opacity: 0.5 },
    iconButtonDisabled: { opacity: 0.3 },
    iconGlyph: { fontSize: 18, color: t.color.inkMuted, fontWeight: "600" },

    // Inline error
    errorWrap: { gap: 2, marginTop: 2 },
    errorRow: {
      borderLeftWidth: 2,
      paddingLeft: t.space.sm,
      paddingVertical: 2,
    },
    errorRowCritical: { borderLeftColor: t.color.error },
    errorRowWarn: { borderLeftColor: t.color.inkSubtle },
    errorText: { fontFamily: t.font.mono, fontSize: 12, lineHeight: 16 },
    errorTextCritical: { color: t.color.errorText },
    errorTextWarn: { color: t.color.inkMuted },

    // Tray header
    trayHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 1,
      borderColor: t.color.rule,
      paddingBottom: t.space.sm,
      marginTop: t.space.sm,
    },
    trayHeaderRight: { flexDirection: "row", alignItems: "center", gap: t.space.md },
    toFix: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      color: t.color.errorText,
    },
  });
}
