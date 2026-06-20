import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
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
  materialsFromShareIntent,
  submitMaterials,
} from "@/lib/materials";

export default function ShareIntentScreen() {
  const queryClient = useQueryClient();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);
  // One optional note applied to every shared item for the LLM to build on.
  const [note, setNote] = useState("");

  const materials = useMemo<Material[]>(
    () => (hasShareIntent ? materialsFromShareIntent(shareIntent) : []),
    [hasShareIntent, shareIntent],
  );
  const submittable = materials.filter((m) => m.kind !== "unsupported");

  function dismiss() {
    resetShareIntent();
    router.replace("/(tabs)/queue");
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
    resetShareIntent();
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
            tone={Sirius.color.inkMuted}
            onPress={dismiss}
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
  container: {
    padding: Sirius.space.xl,
    paddingTop: 72,
    gap: Sirius.space.lg,
  },
  muted: {
    color: Sirius.color.inkMuted,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 23,
  },
  list: { gap: Sirius.space.sm, marginTop: Sirius.space.xs },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
});
