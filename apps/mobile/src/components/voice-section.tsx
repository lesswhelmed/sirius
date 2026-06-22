// "Your voice" settings card (mobile counterpart of the web settings card).
// Edits the user's author voice — a freeform, prose-only style description that
// the worker (Gemini) and the on-device path inject into post drafting. The
// server (User.voiceProfile) is the source of truth; saving mirrors the
// canonical value into the local llm-settings.json cache for offline drafting.
// NOT gated by the on-device flag — voice applies to server drafting too.
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  Eyebrow,
  KeyboardDoneButton,
  PrimaryButton,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { fetchVoiceProfile, saveVoiceProfile } from "@/lib/voice-settings";
import {
  VOICE_GENERATOR_PROMPT,
  VOICE_PROFILE_MAX_CHARS,
} from "@repo/ingest-draft";

export function VoiceSection() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // The server-canonical value last loaded/saved; `value` is the live edit.
  const [saved, setSaved] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [pasteBack, setPasteBack] = useState("");

  useEffect(() => {
    let active = true;
    void fetchVoiceProfile()
      .then((voice) => {
        if (!active) return;
        setSaved(voice);
        setValue(voice);
      })
      .catch((err) => {
        if (!active) return;
        console.warn("[voice] load failed", err);
        setError("Couldn’t load your voice. Check your connection.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const dirty = value !== saved;
  const overLimit = value.length > VOICE_PROFILE_MAX_CHARS;

  async function handleSave() {
    if (busy || !dirty || overLimit) return;
    setBusy(true);
    setError(null);
    try {
      const canonical = await saveVoiceProfile(value);
      // The server sanitizes/caps — reflect exactly what was stored.
      setSaved(canonical);
      setValue(canonical);
    } catch (err) {
      console.warn("[voice] save failed", err);
      setError("Couldn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyPrompt() {
    try {
      await Clipboard.setStringAsync(VOICE_GENERATOR_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("[voice] copy failed", err);
    }
  }

  function handleUsePaste() {
    const trimmed = pasteBack.trim();
    if (!trimmed) return;
    setValue(trimmed.slice(0, VOICE_PROFILE_MAX_CHARS));
    setPasteBack("");
    setShowGenerator(false);
  }

  const statusLine = loading
    ? "Loading…"
    : dirty
      ? "Unsaved changes"
      : saved
        ? "Saved"
        : "No voice saved yet";

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Eyebrow>Your voice</Eyebrow>
        <Text style={styles.subtitle}>
          Shape how your posts are written — this guides tone only, never
          structure.
        </Text>
      </View>

      <View style={styles.field}>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={value}
          onChangeText={setValue}
          editable={!loading && !busy}
          multiline
          maxLength={VOICE_PROFILE_MAX_CHARS}
          placeholder="Describe how you write and talk — your tone, favorite words, humor, what excites you…"
          placeholderTextColor={t.color.inkSubtle}
          selectionColor={t.color.accent}
          accessibilityLabel="Your voice"
        />
        <View style={styles.metaRow}>
          <Text
            style={[styles.status, dirty ? styles.statusDirty : null]}
            accessibilityLiveRegion="polite"
          >
            {statusLine}
          </Text>
          <Text style={[styles.counter, overLimit ? styles.counterOver : null]}>
            {value.length} / {VOICE_PROFILE_MAX_CHARS}
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        label="Save"
        onPress={handleSave}
        busy={busy}
        disabled={loading || !dirty || overLimit}
      />

      <View style={styles.generator}>
        <Pressable
          onPress={() => setShowGenerator((s) => !s)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showGenerator }}
          hitSlop={8}
          style={styles.generatorHeader}
        >
          <Text style={styles.generatorTitle}>
            Not sure what to write? Generate it
          </Text>
          <Text style={styles.generatorChevron}>
            {showGenerator ? "⌄" : "›"}
          </Text>
        </Pressable>

        {showGenerator ? (
          <View style={styles.generatorBody}>
            <Text style={styles.generatorHint}>
              Paste this into ChatGPT or Claude, then paste its answer back
              below.
            </Text>
            <Text style={styles.prompt} selectable>
              {VOICE_GENERATOR_PROMPT}
            </Text>
            <Pressable
              onPress={handleCopyPrompt}
              accessibilityRole="button"
              accessibilityLabel="Copy prompt"
              hitSlop={8}
              style={({ pressed }) => [
                styles.copyButton,
                pressed ? styles.copyButtonPressed : null,
              ]}
            >
              <Text style={styles.copyButtonText}>
                {copied ? "Copied" : "Copy prompt"}
              </Text>
            </Pressable>

            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={pasteBack}
              onChangeText={setPasteBack}
              multiline
              maxLength={VOICE_PROFILE_MAX_CHARS}
              placeholder="Paste the result here…"
              placeholderTextColor={t.color.inkSubtle}
              selectionColor={t.color.accent}
              accessibilityLabel="Generated voice to use"
            />
            <PrimaryButton
              label="Use this"
              onPress={handleUsePaste}
              disabled={pasteBack.trim().length === 0}
            />
          </View>
        ) : null}
      </View>

      <KeyboardDoneButton style={styles.keyboardDone} />
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { gap: t.space.md },
    head: { gap: t.space.xs },
    subtitle: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 18,
      color: t.color.inkMuted,
    },
    field: { gap: 6 },
    input: {
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperRaised,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: t.color.ink,
      minHeight: 48,
    },
    inputMultiline: {
      minHeight: 120,
      maxHeight: 220,
      textAlignVertical: "top",
      paddingTop: 12,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.sm,
    },
    status: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 0.8,
      color: t.color.inkSubtle,
    },
    statusDirty: { color: t.color.accent },
    counter: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    counterOver: { color: t.color.accent },
    error: {
      fontFamily: t.font.sans,
      fontSize: 13,
      lineHeight: 18,
      color: t.color.accent,
    },
    generator: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
    },
    generatorHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.sm,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.md,
    },
    generatorTitle: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 16,
      color: t.color.ink,
    },
    generatorChevron: {
      fontFamily: t.font.serif,
      fontSize: 18,
      color: t.color.inkSubtle,
    },
    generatorBody: {
      gap: t.space.md,
      paddingHorizontal: t.space.lg,
      paddingBottom: t.space.lg,
    },
    generatorHint: {
      fontFamily: t.font.sans,
      fontSize: 12,
      lineHeight: 17,
      color: t.color.inkMuted,
    },
    prompt: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperSunken,
      padding: t.space.md,
      fontFamily: t.font.mono,
      fontSize: 12,
      lineHeight: 18,
      color: t.color.inkMuted,
    },
    copyButton: {
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
    },
    copyButtonPressed: { backgroundColor: t.color.accentSoft },
    copyButtonText: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    keyboardDone: { alignSelf: "flex-end", marginTop: t.space.xs },
  });
}
