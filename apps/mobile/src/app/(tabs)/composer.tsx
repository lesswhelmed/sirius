import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Eyebrow,
  Field,
  PrimaryButton,
  Screen,
  Title,
  TextLink,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { signOut } from "@/lib/auth-client";
import { type Material, submitMaterials } from "@/lib/materials";

const INSTAGRAM_URL_REGEX =
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?/i;
const MAX_URLS_PER_BATCH = 200;

function parseUrls(raw: string): { urls: string[]; igCount: number; deduped: number; capped: number } {
  const seen = new Set<string>();
  const all = raw
    .split(/[\n\r,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const urls: string[] = [];
  let igCount = 0;
  let deduped = 0;
  let capped = 0;
  for (const u of all) {
    if (seen.has(u)) {
      deduped++;
      continue;
    }
    seen.add(u);
    if (urls.length >= MAX_URLS_PER_BATCH) {
      capped++;
      continue;
    }
    urls.push(u);
    if (INSTAGRAM_URL_REGEX.test(u)) igCount++;
  }
  return { urls, igCount, deduped, capped };
}

export default function ComposerScreen() {
  const queryClient = useQueryClient();
  const [urlsInput, setUrlsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach images."
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 8,
    });
    if (!result.canceled) {
      setImages((prev) => [...prev, ...result.assets]);
    }
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (busy) return;
    const { urls, deduped, capped } = parseUrls(urlsInput);
    const trimmedNotes = notes.trim();
    const hasText = urls.length > 0 || trimmedNotes.length > 0;
    const hasImages = images.length > 0;
    if (!hasText && !hasImages) {
      Alert.alert("Nothing to submit", "Add a URL, a note, or an image.");
      return;
    }
    if (deduped > 0 || capped > 0) {
      const parts: string[] = [];
      if (deduped > 0) parts.push(`${deduped} duplicate${deduped === 1 ? "" : "s"} skipped`);
      if (capped > 0) parts.push(`${capped} dropped (cap ${MAX_URLS_PER_BATCH})`);
      Alert.alert("Heads up", parts.join("\n"));
    }

    // Fan out: each URL becomes its own submission so the worker's dedicated
    // IG / YouTube paths fire per-URL. A standalone note is only created when
    // there are no URLs (it would otherwise ride along as URL annotation).
    const materials: Material[] = [];
    for (const u of urls) {
      materials.push({ kind: "url", url: u, notes: trimmedNotes });
    }
    if (urls.length === 0 && trimmedNotes.length > 0) {
      materials.push({ kind: "note", text: trimmedNotes });
    }
    for (const [i, asset] of images.entries()) {
      materials.push({
        kind: "image",
        uri: asset.uri,
        name: asset.fileName ?? `img-${i}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
        notes: trimmedNotes,
      });
    }

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

    setUrlsInput("");
    setNotes("");
    setImages([]);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.push("/(tabs)/queue");
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/sign-in");
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
          <View style={styles.header}>
            <View style={styles.headerMain}>
              <Eyebrow>Section III — Ingest</Eyebrow>
              <Title accent=".">Capture</Title>
            </View>
            <TextLink
              label="Sign out"
              tone={Sirius.color.inkMuted}
              onPress={handleSignOut}
            />
          </View>

          <Field
            label="URLs (one per line)"
            style={styles.multiline}
            placeholder={"https://example.com/post\nhttps://instagram.com/p/..."}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            value={urlsInput}
            onChangeText={setUrlsInput}
            editable={!busy}
          />

          <Field
            label="Notes"
            style={styles.multiline}
            placeholder="Anything to remember about these…"
            multiline
            value={notes}
            onChangeText={setNotes}
            editable={!busy}
          />

          <View style={styles.imagesSection}>
            <Eyebrow>Images</Eyebrow>
            <View style={styles.imagesRow}>
              {images.map((img, idx) => (
                <Pressable
                  key={img.assetId ?? img.uri}
                  onPress={() => removeImage(idx)}
                  style={styles.thumbWrap}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove image ${idx + 1}`}
                >
                  <Image
                    source={{ uri: img.uri }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={120}
                  />
                  <View style={styles.thumbBadge}>
                    <Text style={styles.thumbBadgeText}>×</Text>
                  </View>
                </Pressable>
              ))}
              <Pressable
                onPress={pickImages}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Add image"
                style={({ pressed }) => [
                  styles.pickButton,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Text style={styles.pickButtonText}>+ Add image</Text>
              </Pressable>
            </View>
          </View>

          <PrimaryButton
            label="Submit"
            onPress={submit}
            busy={busy}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: Sirius.space.xl,
    paddingTop: 64,
    gap: Sirius.space.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: Sirius.space.xs,
  },
  headerMain: { gap: Sirius.space.xs },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
  imagesSection: { gap: Sirius.space.sm },
  imagesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Sirius.space.md,
  },
  thumbWrap: { position: "relative" },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  thumbBadge: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: Sirius.radius.pill,
    backgroundColor: Sirius.color.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbBadgeText: {
    color: Sirius.color.paper,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 18,
  },
  pickButton: {
    height: 76,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: Sirius.radius.none,
    borderWidth: 1,
    borderColor: Sirius.color.accent,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  pickButtonText: {
    color: Sirius.color.accent,
    fontWeight: "600",
    fontFamily: Sirius.font.mono,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  pressed: { backgroundColor: Sirius.color.accentSoft },
  disabled: { opacity: 0.45 },
  submit: { marginTop: Sirius.space.sm },
});
