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
  // stays true and `ShareIntentNavigator` (app/_layout.tsx) re-pushes the pane.
  // `resetShareIntent` isn't memoised by expo-share-intent (fresh identity each
  // provider render), so hold it in a ref and reset on real unmount only —
  // otherwise a provider re-render would wipe the payload mid-edit.
  const resetRef = useRef(resetShareIntent);
  useEffect(() => {
    resetRef.current = resetShareIntent;
  });
  useEffect(() => () => resetRef.current(), []);

  function dismiss() {
    resetShareIntent();
    dismissModal();
  }

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
    setDone(true);
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
