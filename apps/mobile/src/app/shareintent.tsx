import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  KindLabel,
  PageHeader,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { useSession } from "@/lib/auth-client";
import {
  describeMaterial,
  type Material,
  materialsFromShareIntent,
  submitMaterials,
} from "@/lib/materials";

const KIND_LABELS: Record<Material["kind"], string> = {
  url: "Link",
  note: "Text",
  image: "Image",
  unsupported: "Unsupported",
};

export default function ShareIntentScreen() {
  const queryClient = useQueryClient();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntentContext();
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState(false);

  const materials = useMemo<Material[]>(
    () => (hasShareIntent ? materialsFromShareIntent(shareIntent) : []),
    [hasShareIntent, shareIntent]
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
      const result = await submitMaterials(materials, { force: false });
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
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="Shared with Sirius"
          title="Queue this"
          titleAccent="."
          subtitle={`${submittable.length} item${
            submittable.length === 1 ? "" : "s"
          } ready to send to the worker.`}
        />

        <View style={styles.list}>
          {materials.map((material) => {
            const unsupported = material.kind === "unsupported";
            return (
              <View
                key={`${material.kind}:${describeMaterial(material)}`}
                style={[styles.card, unsupported && styles.cardMuted]}
              >
                {material.kind === "image" ? (
                  <Image
                    source={{ uri: material.uri }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={120}
                  />
                ) : null}
                <View style={styles.cardText}>
                  <KindLabel
                    tone={
                      unsupported ? Sirius.color.inkSubtle : Sirius.color.accent
                    }
                  >
                    {KIND_LABELS[material.kind]}
                  </KindLabel>
                  <Text
                    style={[
                      styles.cardBody,
                      unsupported && styles.cardBodyMuted,
                    ]}
                    numberOfLines={3}
                  >
                    {describeMaterial(material)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  list: { gap: Sirius.space.md, marginTop: Sirius.space.xs },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Sirius.space.md,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperRaised,
    padding: Sirius.space.md,
  },
  cardMuted: { borderStyle: "dashed", backgroundColor: "transparent" },
  cardText: { flex: 1, gap: Sirius.space.xs },
  cardBody: {
    fontSize: 15,
    fontWeight: "500",
    color: Sirius.color.ink,
    fontFamily: Sirius.font.serif,
  },
  cardBodyMuted: { fontWeight: "400", color: Sirius.color.inkMuted },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
});
