import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
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
  materialsFromText,
  submitMaterials,
} from "@/lib/materials";

export default function CaptureScreen() {
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ text?: string }>();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const incoming = typeof params.text === "string" ? params.text : "";
  const materials = useMemo<Material[]>(
    () => materialsFromText(incoming),
    [incoming],
  );
  const submittable = materials.filter((m) => m.kind !== "unsupported");

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
            tone={Sirius.color.inkMuted}
            onPress={() => router.replace("/(tabs)/queue")}
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
  container: { padding: Sirius.space.xl, paddingTop: 72, gap: Sirius.space.lg },
  muted: {
    color: Sirius.color.inkMuted,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    lineHeight: 23,
  },
  list: { gap: Sirius.space.sm, marginTop: Sirius.space.xs },
});
