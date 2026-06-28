import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  CaptureDone,
  Field,
  KeyboardDoneButton,
  PageHeader,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextLink,
  TrayRow,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { useSession } from "@/lib/auth-client";
import { dismissModal } from "@/lib/dismiss-modal";
import { trayTag } from "@/lib/material-kinds";
import {
  applyNote,
  describeMaterial,
  type Material,
  materialsFromText,
  submitMaterials,
  type SubmitMaterialsResult,
} from "@/lib/materials";

export default function CaptureScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ text?: string; autosubmit?: string }>();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState("");

  const incoming = typeof params.text === "string" ? params.text : "";
  const materials = useMemo<Material[]>(
    () => materialsFromText(incoming),
    [incoming],
  );
  const submittable = materials.filter((m) => m.kind !== "unsupported");

  // Submit ALREADY-note-applied materials. Factored out so a forced re-process
  // (after a content-hash dedup) can resubmit the same objects without
  // re-applying the note. Shared by the manual tap and the hands-free autosubmit.
  async function doSubmit(prepared: Material[], force: boolean) {
    setBusy(true);
    let result: SubmitMaterialsResult;
    try {
      result = await submitMaterials(prepared, { force });
    } finally {
      setBusy(false);
    }
    if (result.errors.length > 0) {
      Alert.alert("Some submissions failed", result.errors.join("\n\n"));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });

    // The server already had some (or all) of these — content-hash dedup created
    // nothing new, so they aren't queued. Offer a forced re-process rather than a
    // misleading "in the queue" confirmation.
    if (result.deduped.length > 0) {
      const dupes = result.deduped;
      const madeProgress = result.submitted > 0 || result.queued > 0;
      const n = dupes.length;
      Alert.alert(
        "Already captured",
        `${n === 1 ? "This is" : `${n} of these are`} already in your catalog, so ${
          n === 1 ? "it wasn't" : "they weren't"
        } queued again. Process ${
          n === 1 ? "it" : "them"
        } again to create a fresh post?`,
        [
          { text: "Process again", onPress: () => void doSubmit(dupes, true) },
          {
            text: madeProgress ? "Done" : "Not now",
            style: "cancel",
            onPress: () => (madeProgress ? setDone(true) : dismissModal()),
          },
        ],
      );
      return;
    }

    setDone(true);
  }

  function submit() {
    if (busy || submittable.length === 0) return;
    void doSubmit(applyNote(materials, note.trim() || undefined), false);
  }

  // Hands-free fallback: the background Siri intent (QuickCaptureIntent) opens
  // the app with autosubmit=1 when it can't submit directly (signed out / expired
  // cookie). Once a session is present, queue the dictated text automatically so
  // the user never has to tap — and exactly once.
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (params.autosubmit !== "1") return;
    if (autoSubmitted.current) return;
    if (isPending || !session || busy || done) return;
    if (submittable.length === 0) return;
    autoSubmitted.current = true;
    // Defer out of the effect body so submit()'s setState isn't synchronous.
    const id = setTimeout(() => void submit(), 0);
    return () => clearTimeout(id);
    // submit() is stable enough for this one-shot; deps cover the gating signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.autosubmit, isPending, session, busy, done, submittable.length]);

  if (isPending) {
    return (
      <Screen style={styles.centered}>
        <ActivityIndicator color={t.color.accent} />
      </Screen>
    );
  }

  if (done) {
    return (
      <CaptureDone
        message="Your capture is in the queue. The worker takes it from here."
        onClose={dismissModal}
      />
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
          Run &ldquo;Capture in Sirius&rdquo; with a note or link to queue it.
        </Text>
        <SecondaryButton label="Close" onPress={dismissModal} />
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
            tone={t.color.inkMuted}
            onPress={dismissModal}
            disabled={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    noteInput: { minHeight: 80, textAlignVertical: "top", paddingTop: 12 },
    keyboardDone: { alignSelf: "flex-end" },
    centered: { alignItems: "center", justifyContent: "center" },
    centeredPad: {
      justifyContent: "center",
      paddingHorizontal: t.space.xl,
      gap: t.space.lg,
    },
    container: { padding: t.space.xl, paddingTop: 72, gap: t.space.lg },
    muted: {
      color: t.color.inkMuted,
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 23,
    },
    list: { gap: t.space.sm, marginTop: t.space.xs },
  });
}
