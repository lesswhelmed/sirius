import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
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
  materialsFromShareIntent,
  submitMaterials,
  type SubmitMaterialsResult,
} from "@/lib/materials";

export default function ShareIntentScreen() {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const queryClient = useQueryClient();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // One optional note applied to every shared item for the LLM to build on.
  const [note, setNote] = useState("");

  const materials = useMemo<Material[]>(
    () => (hasShareIntent ? materialsFromShareIntent(shareIntent) : []),
    [hasShareIntent, shareIntent],
  );
  const submittable = materials.filter((m) => m.kind !== "unsupported");

  // Clear the share payload whenever this pane leaves — including a native
  // swipe-down dismiss, which never runs `dismiss()`. Without this `hasShareIntent`
  // stays true: on Android the `ShareIntentNavigator` (app/_layout.tsx, Android-
  // only) would re-push the pane, and on iOS a stale payload could leak into a
  // later `+native-intent` open. `resetShareIntent` isn't memoised by
  // expo-share-intent (fresh identity each provider render), so hold it in a ref
  // and reset on real unmount only — otherwise a provider re-render would wipe
  // the payload mid-edit.
  const resetRef = useRef(resetShareIntent);
  useEffect(() => {
    resetRef.current = resetShareIntent;
  });
  useEffect(() => () => resetRef.current(), []);

  function dismiss() {
    resetShareIntent();
    dismissModal();
  }

  // Submit a set of ALREADY-note-applied materials. Factored out so a forced
  // re-process (after a content-hash dedup) can resubmit the exact same objects
  // without re-applying the note (which would double it).
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
    // nothing new, so they're NOT in the queue. Don't claim success; tell the
    // user and offer to force a fresh post instead of silently doing nothing.
    if (result.deduped.length > 0) {
      const dupes = result.deduped;
      const madeProgress = result.submitted > 0 || result.queued > 0;
      const n = dupes.length;
      Alert.alert(
        "Already shared",
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
            onPress: () => (madeProgress ? setDone(true) : dismiss()),
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
        message="Your share is in the queue. The worker takes it from here."
        onClose={dismiss}
      />
    );
  }

  if (!session) {
    return (
      <Screen style={styles.centeredPad}>
        <PageHeader title="Sign in to queue this" titleAccent="." />
        <Text style={styles.muted}>
          Your shared content is waiting. Sign in and share again to queue it.
        </Text>
        <PrimaryButton
          label="Sign in"
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </Screen>
    );
  }

  if (!hasShareIntent || materials.length === 0) {
    return (
      <Screen style={styles.centeredPad}>
        <PageHeader title="Nothing shared" titleAccent="." />
        <Text style={styles.muted}>
          Share a link, note, or image to Sirius to queue it.
        </Text>
        <SecondaryButton label="Close" onPress={dismiss} />
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
            eyebrow="Shared with Sirius"
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
                leading={
                  material.kind === "image" ? (
                    <Image
                      source={{ uri: material.uri }}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={120}
                    />
                  ) : undefined
                }
              />
            ))}
          </View>

          {submittable.length > 0 ? (
            <Field
              label="Notes (optional)"
              style={styles.noteInput}
              placeholder="What interests you about this…"
              multiline
              autoCapitalize="sentences"
              value={note}
              onChangeText={setNote}
            />
          ) : null}
          <KeyboardDoneButton style={styles.keyboardDone} />

          <PrimaryButton
            label={submittable.length === 0 ? "Nothing to queue" : "Queue it"}
            onPress={submit}
            busy={busy}
            disabled={submittable.length === 0}
          />

          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={dismiss}
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
    container: {
      padding: t.space.xl,
      paddingTop: 72,
      gap: t.space.lg,
    },
    muted: {
      color: t.color.inkMuted,
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 23,
    },
    list: { gap: t.space.sm, marginTop: t.space.xs },
    thumb: {
      width: 44,
      height: 44,
      borderRadius: t.radius.none,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
  });
}
