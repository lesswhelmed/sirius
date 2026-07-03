// Hidden production crash-diagnostics surface, designed to sit at the bottom
// of the Account/settings screen (mount with a bare `<CrashDiagnostics />`).
//
// The dev-only <LastCrashBanner/> leaves production with no way to see the
// crash record `@/lib/crash-log` persists, so this fills the gap without
// exposing anything scary to casual users: it renders only a muted
// "Diagnostics" caption, and the panel opens only after 7 rapid taps (within
// a 3s window) or a long-press — a support-guided gesture, not a discoverable
// one. The revealed panel shows a SANITIZED summary (timestamp, source, fatal
// flag, first error line only). Raw stack frames are NEVER rendered; the full
// JSON record leaves the device only via the explicit "Copy full report"
// action. crash-log helpers never throw (unreadable file → null), so neither
// does this component.
import * as Clipboard from "expo-clipboard";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { TextLink } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import {
  clearLastCrash,
  type CrashRecord,
  readLastCrash,
} from "@/lib/crash-log";

const REVEAL_TAP_COUNT = 7;
const REVEAL_TAP_WINDOW_MS = 3000;
const REVEAL_LONG_PRESS_MS = 800;
const ERROR_LINE_MAX_CHARS = 200;

export function CrashDiagnostics(): React.ReactElement {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [revealed, setRevealed] = React.useState(false);
  // undefined = reveal in flight (loading); null = no record on disk.
  const [crash, setCrash] = React.useState<CrashRecord | null | undefined>(
    undefined,
  );
  const [copied, setCopied] = React.useState(false);
  const taps = React.useRef({ count: 0, windowStart: 0 });

  function reveal() {
    taps.current = { count: 0, windowStart: 0 };
    setCopied(false);
    setCrash(undefined);
    setRevealed(true);
    // Re-read on every reveal so a crash from earlier in this session shows up.
    void readLastCrash().then(setCrash);
  }

  function onTriggerPress() {
    const now = Date.now();
    if (now - taps.current.windowStart > REVEAL_TAP_WINDOW_MS) {
      taps.current = { count: 1, windowStart: now };
    } else {
      taps.current.count += 1;
    }
    if (taps.current.count >= REVEAL_TAP_COUNT) reveal();
  }

  async function onCopy() {
    if (!crash) return;
    try {
      // Full record incl. stack — an explicit, user-initiated export.
      await Clipboard.setStringAsync(JSON.stringify(crash, null, 2));
      setCopied(true);
    } catch {
      // Clipboard unavailable — the summary stays on screen regardless.
    }
  }

  function onClear() {
    void clearLastCrash();
    setCrash(null);
    setCopied(false);
  }

  function onHide() {
    setRevealed(false);
    setCopied(false);
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Diagnostics"
        accessibilityHint="Long-press to show crash diagnostics"
        hitSlop={12}
        delayLongPress={REVEAL_LONG_PRESS_MS}
        onPress={onTriggerPress}
        onLongPress={reveal}
      >
        <Text style={styles.trigger}>Diagnostics</Text>
      </Pressable>

      {revealed ? (
        <View style={styles.card}>
          {crash === undefined ? (
            <Text style={styles.body}>Loading…</Text>
          ) : crash === null ? (
            <Text style={styles.body}>No crash recorded.</Text>
          ) : (
            <>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>When</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {formatTimestamp(crash.timestamp)}
                </Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Source</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {crash.source}
                  {crash.isFatal ? " · fatal" : ""}
                </Text>
              </View>
              <Text style={styles.errorLine}>{firstErrorLine(crash)}</Text>
            </>
          )}
          <View style={styles.actions}>
            {crash ? (
              <TextLink
                label={copied ? "Copied" : "Copy full report"}
                onPress={() => void onCopy()}
              />
            ) : null}
            {crash ? (
              <TextLink label="Clear" tone={t.color.danger} onPress={onClear} />
            ) : null}
            <TextLink label="Hide" tone={t.color.inkMuted} onPress={onHide} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// "name: message" with any embedded stack stripped: cut before the first
// stack-frame line ("\n    at fn (file:1:2)"), keep only the first line, and
// truncate. Raw frames must never render — copy-to-clipboard is the only path
// to the full record.
function firstErrorLine(record: CrashRecord): string {
  const raw = `${record.name ?? "Error"}: ${record.message}`;
  const frameIdx = raw.search(/\n\s*at\s/);
  const head = frameIdx >= 0 ? raw.slice(0, frameIdx) : raw;
  const line = (head.split("\n")[0] ?? "").trim();
  return line.length > ERROR_LINE_MAX_CHARS
    ? `${line.slice(0, ERROR_LINE_MAX_CHARS - 1)}…`
    : line;
}

// Human-readable local time; falls back to the raw string if unparseable.
function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso : new Date(ts).toLocaleString();
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { gap: t.space.sm },
    // Mirrors the settings sectionLabel caption, centered as a quiet footer.
    trigger: {
      alignSelf: "center",
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
      paddingVertical: t.space.xs,
    },
    card: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
      gap: t.space.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.lg,
    },
    rowLabel: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkSubtle,
    },
    rowValue: {
      flexShrink: 1,
      fontFamily: t.font.serif,
      fontSize: 15,
      color: t.color.ink,
    },
    body: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 18,
      color: t.color.inkMuted,
    },
    errorLine: {
      fontFamily: t.font.mono,
      fontSize: 12,
      lineHeight: 17,
      color: t.color.errorText,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xl,
      paddingTop: t.space.xs,
    },
  });
}
