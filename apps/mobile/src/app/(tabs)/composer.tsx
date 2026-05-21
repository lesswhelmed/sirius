import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, apiPostForm, apiPostJson } from "@/lib/api";
import { signOut } from "@/lib/auth-client";

type SubmitOk = {
  id: string;
  kind: string;
  status: string;
  deduped: boolean;
  batchId?: string | null;
  imageIndex?: number | null;
  totalCount?: number | null;
};

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

    setBusy(true);
    const errors: string[] = [];
    try {
      if (urls.length > 0) {
        // Fan out: each URL becomes its own submission so the worker's
        // dedicated IG / YouTube paths fire per-URL. One submission with N
        // URLs collapses into a single FINDING post.
        for (let i = 0; i < urls.length; i++) {
          const u = urls[i]!;
          try {
            await apiPostJson<SubmitOk>("/api/app/ingest", {
              urls: [u],
              notes: trimmedNotes,
              force: false,
            });
          } catch (err) {
            errors.push(formatError(err, `URL ${i + 1}/${urls.length}`));
          }
        }
      } else if (trimmedNotes.length > 0) {
        try {
          await apiPostJson<SubmitOk>("/api/app/ingest", {
            urls: [],
            notes: trimmedNotes,
            force: false,
          });
        } catch (err) {
          errors.push(formatError(err, "Note submit"));
        }
      }

      if (hasImages) {
        const batchId = Crypto.randomUUID();
        for (let i = 0; i < images.length; i++) {
          const asset = images[i];
          const form = new FormData();
          // RN FormData accepts { uri, name, type } as a "file" part.
          form.append("image", {
            uri: asset.uri,
            name: asset.fileName ?? `img-${i}.jpg`,
            type: asset.mimeType ?? "image/jpeg",
          } as unknown as Blob);
          form.append("batchId", batchId);
          form.append("imageIndex", String(i));
          form.append("totalCount", String(images.length));
          form.append("notes", trimmedNotes);
          try {
            await apiPostForm<SubmitOk>("/api/app/ingest-images", form);
          } catch (err) {
            errors.push(formatError(err, `image ${i + 1}`));
          }
        }
      }
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
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Capture</Text>
          <Pressable onPress={handleSignOut} hitSlop={12}>
            <Text style={styles.link}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>URLs (one per line)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder={"https://example.com/post\nhttps://instagram.com/p/..."}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          value={urlsInput}
          onChangeText={setUrlsInput}
          editable={!busy}
        />

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Anything to remember about these…"
          multiline
          value={notes}
          onChangeText={setNotes}
          editable={!busy}
        />

        <View style={styles.imagesRow}>
          {images.map((img, idx) => (
            <Pressable
              key={`${img.uri}-${idx}`}
              onPress={() => removeImage(idx)}
              style={styles.thumbWrap}
              accessibilityLabel="Remove image"
            >
              <Image source={{ uri: img.uri }} style={styles.thumb} />
              <View style={styles.thumbBadge}>
                <Text style={styles.thumbBadgeText}>×</Text>
              </View>
            </Pressable>
          ))}
          <Pressable
            onPress={pickImages}
            disabled={busy}
            style={({ pressed }) => [
              styles.pickButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.pickButtonText}>+ Add image</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={submit}
          disabled={busy}
          style={({ pressed }) => [
            styles.primaryButton,
            (busy || pressed) && styles.primaryButtonPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Submit</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatError(err: unknown, label: string): string {
  if (err instanceof ApiError) return `${label}: ${err.message} (${err.status})`;
  if (err instanceof Error) return `${label}: ${err.message}`;
  return `${label}: unknown error`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    padding: 24,
    paddingTop: 64,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  title: { fontSize: 28, fontWeight: "600" },
  link: { color: "#208AEF", fontWeight: "500" },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#60646C",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D0D5DC",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  imagesRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  thumbWrap: { position: "relative" },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: "#E6E8EC" },
  thumbBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbBadgeText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  pickButton: {
    height: 72,
    minWidth: 96,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#208AEF",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  pickButtonText: { color: "#208AEF", fontWeight: "500" },
  pressed: { opacity: 0.7 },
  primaryButton: {
    backgroundColor: "#208AEF",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  primaryButtonPressed: { opacity: 0.85 },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
