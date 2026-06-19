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
import { Sirius } from "@/constants/theme";
import { fetchVoiceProfile, saveVoiceProfile } from "@/lib/voice-settings";
import {
  VOICE_GENERATOR_PROMPT,
  VOICE_PROFILE_MAX_CHARS,
} from "@repo/ingest-draft";

export function VoiceSection() {
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
          placeholderTextColor={Sirius.color.inkSubtle}
          selectionColor={Sirius.color.accent}
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
              placeholderTextColor={Sirius.color.inkSubtle}
              selectionColor={Sirius.color.accent}
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

const styles = StyleSheet.create({
  wrap: { gap: Sirius.space.md },
  head: { gap: Sirius.space.xs },
  subtitle: {
    fontFamily: Sirius.font.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Sirius.color.inkMuted,
  },
  field: { gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: Sirius.color.ink,
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
    gap: Sirius.space.sm,
  },
  status: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    color: Sirius.color.inkSubtle,
  },
  statusDirty: { color: Sirius.color.accent },
  counter: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    color: Sirius.color.inkSubtle,
  },
  counterOver: { color: Sirius.color.accent },
  error: {
    fontFamily: Sirius.font.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Sirius.color.accent,
  },
  generator: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
  },
  generatorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.sm,
    paddingHorizontal: Sirius.space.lg,
    paddingVertical: Sirius.space.md,
  },
  generatorTitle: {
    flex: 1,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    color: Sirius.color.ink,
  },
  generatorChevron: {
    fontFamily: Sirius.font.serif,
    fontSize: 18,
    color: Sirius.color.inkSubtle,
  },
  generatorBody: {
    gap: Sirius.space.md,
    paddingHorizontal: Sirius.space.lg,
    paddingBottom: Sirius.space.lg,
  },
  generatorHint: {
    fontFamily: Sirius.font.sans,
    fontSize: 12,
    lineHeight: 17,
    color: Sirius.color.inkMuted,
  },
  prompt: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperSunken,
    padding: Sirius.space.md,
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    lineHeight: 18,
    color: Sirius.color.inkMuted,
  },
  copyButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Sirius.color.ruleStrong,
    paddingHorizontal: Sirius.space.lg,
    paddingVertical: Sirius.space.sm,
  },
  copyButtonPressed: { backgroundColor: Sirius.color.accentSoft },
  copyButtonText: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.accent,
  },
  keyboardDone: { alignSelf: "flex-end", marginTop: Sirius.space.xs },
});
