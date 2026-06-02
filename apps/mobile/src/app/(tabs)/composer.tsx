import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ActionCard,
  Eyebrow,
  Field,
  PrimaryButton,
  Screen,
  Sheet,
  TextLink,
  Title,
  TrayRow,
} from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { signOut } from "@/lib/auth-client";
import {
  CAPTURE_KINDS,
  type CaptureKind,
  type CaptureKindKey,
  trayTag,
} from "@/lib/material-kinds";
import {
  describeMaterial,
  type Material,
  MAX_URLS_PER_BATCH,
  submitMaterials,
  urlMaterialsFromText,
} from "@/lib/materials";

// A material staged in the tray, with a stable id for keys + removal.
type StagedMaterial = { uid: string; material: Material };

const FORM_COPY: Record<
  Extract<CaptureKindKey, "link" | "note">,
  { title: string; label: string; placeholder: string }
> = {
  link: {
    title: "Add link",
    label: "URLs (one per line)",
    placeholder: "https://example.com/post\nhttps://instagram.com/p/…",
  },
  note: {
    title: "Add note",
    label: "Note",
    placeholder: "Anything to remember…",
  },
};

// Split the grid into rows of two so the action cards lay out as a tidy 2-up
// grid regardless of how many kinds the registry grows to.
function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    out.push(items.slice(i, i + 2));
  }
  return out;
}

export default function ComposerScreen() {
  const queryClient = useQueryClient();
  const [tray, setTray] = useState<StagedMaterial[]>([]);
  const [activeKey, setActiveKey] = useState<CaptureKindKey | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const trayCountLabel = useMemo(() => {
    if (tray.length === 0) return "Tray empty";
    return `${tray.length} item${tray.length === 1 ? "" : "s"} in tray`;
  }, [tray.length]);

  function addToTray(materials: Material[]) {
    if (materials.length === 0) return;
    setTray((prev) => [
      ...prev,
      ...materials.map((material) => ({ uid: Crypto.randomUUID(), material })),
    ]);
  }

  function removeFromTray(uid: string) {
    setTray((prev) => prev.filter((entry) => entry.uid !== uid));
  }

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
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.9,
      selectionLimit: 8,
    });
    if (result.canceled) return;
    addToTray(
      result.assets.map((asset, i) => ({
        kind: "image",
        uri: asset.uri,
        name: asset.fileName ?? `img-${i}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      }))
    );
  }

  function onCardPress(kind: CaptureKind) {
    if (busy) return;
    if (kind.input === "picker") {
      void pickImages();
      return;
    }
    setDraft("");
    setActiveKey(kind.key);
  }

  function confirmForm() {
    if (activeKey === "link") {
      const { materials, deduped, capped } = urlMaterialsFromText(draft);
      if (materials.length === 0) {
        Alert.alert("No links", "Paste at least one URL.");
        return;
      }
      addToTray(materials);
      if (deduped > 0 || capped > 0) {
        const parts: string[] = [];
        if (deduped > 0)
          parts.push(`${deduped} duplicate${deduped === 1 ? "" : "s"} skipped`);
        if (capped > 0) parts.push(`${capped} dropped (cap ${MAX_URLS_PER_BATCH})`);
        Alert.alert("Heads up", parts.join("\n"));
      }
    } else if (activeKey === "note") {
      const text = draft.trim();
      if (text.length === 0) {
        Alert.alert("Empty note", "Write something first.");
        return;
      }
      addToTray([{ kind: "note", text }]);
    }
    setActiveKey(null);
    setDraft("");
  }

  async function submit() {
    if (busy || tray.length === 0) return;
    setBusy(true);
    let errors: string[] = [];
    try {
      const result = await submitMaterials(
        tray.map((entry) => entry.material),
        { force: false }
      );
      errors = result.errors;
    } finally {
      setBusy(false);
    }

    if (errors.length > 0) {
      Alert.alert("Some submissions failed", errors.join("\n\n"));
      return;
    }

    setTray([]);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.push("/(tabs)/queue");
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/sign-in");
  }

  const formCopy =
    activeKey === "link" || activeKey === "note" ? FORM_COPY[activeKey] : null;

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
              <Title accent="." accessibilityRole="header">
                Capture
              </Title>
            </View>
            <TextLink
              label="Sign out"
              tone={Sirius.color.inkMuted}
              onPress={handleSignOut}
            />
          </View>

          <Text style={styles.prompt}>What are you adding?</Text>
          <View style={styles.grid}>
            {pairs(CAPTURE_KINDS).map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.gridRow}>
                {row.map((kind) => (
                  <ActionCard
                    key={kind.key}
                    label={kind.label}
                    symbol={kind.symbol}
                    glyph={kind.glyph}
                    active={activeKey === kind.key}
                    accessibilityHint={kind.hint}
                    disabled={busy}
                    onPress={() => onCardPress(kind)}
                  />
                ))}
                {row.length === 1 ? <View style={styles.flex} /> : null}
              </View>
            ))}
          </View>

          <View style={styles.trayHeader}>
            <Eyebrow>In tray</Eyebrow>
            <Eyebrow
              accessibilityLiveRegion="polite"
              accessibilityLabel={trayCountLabel}
            >
              {tray.length}
            </Eyebrow>
          </View>

          {tray.length === 0 ? (
            <Text style={styles.emptyTray}>
              Nothing staged yet. Add a link, note, or photos above.
            </Text>
          ) : (
            <View style={styles.trayList}>
              {tray.map((entry) => (
                <TrayRow
                  key={entry.uid}
                  tag={trayTag(entry.material)}
                  description={describeMaterial(entry.material)}
                  removeLabel={`Remove ${trayTag(entry.material).toLowerCase()}`}
                  onRemove={() => removeFromTray(entry.uid)}
                  leading={
                    entry.material.kind === "image" ? (
                      <Image
                        source={{ uri: entry.material.uri }}
                        style={styles.thumb}
                        contentFit="cover"
                        transition={120}
                      />
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}

          <PrimaryButton
            label={tray.length === 0 ? "Add something to submit" : "Submit"}
            onPress={submit}
            busy={busy}
            disabled={tray.length === 0}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={activeKey === "link" || activeKey === "note"}
        title={formCopy?.title}
        onClose={() => setActiveKey(null)}
      >
        {formCopy ? (
          <>
            <Field
              label={formCopy.label}
              style={styles.sheetInput}
              placeholder={formCopy.placeholder}
              multiline
              autoFocus
              autoCapitalize={activeKey === "link" ? "none" : "sentences"}
              autoCorrect={activeKey !== "link"}
              value={draft}
              onChangeText={setDraft}
            />
            <PrimaryButton label="Add to tray" onPress={confirmForm} />
          </>
        ) : null}
      </Sheet>
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
  prompt: {
    fontFamily: Sirius.font.serif,
    fontSize: 20,
    color: Sirius.color.ink,
  },
  grid: { gap: Sirius.space.md },
  gridRow: { flexDirection: "row", gap: Sirius.space.md },
  trayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: Sirius.color.rule,
    paddingBottom: Sirius.space.sm,
    marginTop: Sirius.space.sm,
  },
  emptyTray: {
    fontFamily: Sirius.font.serif,
    fontSize: 15,
    color: Sirius.color.inkMuted,
    fontStyle: "italic",
  },
  trayList: { gap: Sirius.space.sm },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Sirius.radius.none,
    backgroundColor: Sirius.color.paperSunken,
    borderWidth: 1,
    borderColor: Sirius.color.rule,
  },
  sheetInput: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
  submit: { marginTop: Sirius.space.sm },
});
