// The omni-ingest Capture tab. Front door = ONE three-region omni-ingest flow,
// host adaptation of the SAME design the web composer ships:
//
//   [OmniInput] → [StagingTray of SmartCards] → [UnifiedActionButton "Process N"]
//
// ALL classification, validation, override-legality, dedup, and platform
// sub-labelling come from the SHARED, pure @repo/ingest-classify package — the
// SAME core the web composer consumes (ZERO duplicated logic). This screen only
// owns host concerns: the native affordances (text field, camera, library,
// files, audio), the uri/asset registry the pure core never sees, and the
// FROZEN submitMaterials() submit path (endpoints/worker/DB untouched).
import type { RepoPreview } from "@repo/github-ingest";
import {
  classifyFile,
  classifyText,
  type ClassifiedItem,
  type IngestKind,
  overrideKind,
  platformFor,
  validateItem,
} from "@repo/ingest-classify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActionCard,
  Eyebrow,
  Field,
  KeyboardDoneButton,
  PrimaryButton,
  Screen,
  Sheet,
  TextLink,
  Title,
} from "@/components/sirius";
import {
  SmartCard,
  TrayErrorSummary,
  TrayHeader,
} from "@/components/omni-tray";
import { AudienceSheet } from "@/components/audience-sheet";

import { BottomTabInset, type Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet, apiPostJson } from "@/lib/api";
import {
  type AudienceValue,
  DEFAULT_AUDIENCE,
  describeAudience,
  useGroups,
} from "@/lib/groups";
import { isModelReady } from "@/lib/llm/engine";
import { ON_DEVICE_AI_ENABLED } from "@/lib/llm/flag";
import { getLlmSettings, updateLlmSettings } from "@/lib/llm/settings";
import {
  type Material,
  submitMaterials,
  type SubmitMaterialsResult,
} from "@/lib/materials";
import {
  deriveTrayErrors,
  descriptorFromAsset,
  type FileRegistry,
  type RnAsset,
  toMaterialPairs,
} from "@/lib/omni-ingest";
import { discardStagedCopy, stageBinaryCopy } from "@/lib/outbox";
import { presentPaywall } from "@/lib/purchases";
import { useAiUsage } from "@/lib/purchases/use-usage";
import { kickSync } from "@/lib/sync/engine";
import { UsageMeter } from "@/components/subscription-section";

// Monotonic counter for unique fallback filenames (camera/voice-memo captures
// that arrive without a name). A module-scoped counter keeps name generation
// out of `Date.now()` — which the React-Compiler purity lint flags as impure
// even inside async handlers — while still guaranteeing uniqueness per session.
let captureSeq = 0;
function nextCaptureName(prefix: string, ext: string): string {
  captureSeq += 1;
  return `${prefix}-${captureSeq}.${ext}`;
}

export default function ComposerScreen() {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const queryClient = useQueryClient();

  // The tray is now ClassifiedItem[] (from the shared package) + a registry that
  // holds the real RN asset per id (the pure core only ever saw metadata) + a
  // per-card optional note (kept out of the pure core, which has no notes).
  // The registry is STATE (not a ref) so the render-time thumbnail/uri reads are
  // legal under the React-Compiler purity rules; writes go through setRegistry.
  const [items, setItems] = useState<ClassifiedItem[]>([]);
  const [registry, setRegistry] = useState<FileRegistry>(new Map());
  const [notesById, setNotesById] = useState<Map<string, string>>(new Map());

  // Omni text field: paste/type URLs + notes. A multi-URL paste auto-splits into
  // one card per URL via classifyText (package) on commit.
  const [omniText, setOmniText] = useState("");

  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  // The post audience (read-visibility tier + any chosen share groups). Defaults
  // to PRIVATE; opening the AudienceSheet lets the user widen it or pick groups.
  const [audience, setAudience] = useState<AudienceValue>(DEFAULT_AUDIENCE);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);

  // Groups, for the audience summary line (describeAudience names the chosen set).
  const { data: groupsData } = useGroups();
  const groups = groupsData?.groups ?? [];

  // Media chooser sheet (camera vs library). iOS requires the picker fire only
  // AFTER the sheet dismisses (see runAfterMediaSheet).
  const [mediaSheet, setMediaSheet] = useState<null | "photo" | "video">(null);
  const pendingMediaAction = useRef<null | (() => void)>(null);
  // Audio capture sheet: record a voice memo or pick an audio file.
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Repository sheet: paste a GitHub URL, fetch the server-rendered preview.
  const [repoSheetOpen, setRepoSheetOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoPreview, setRepoPreview] = useState<RepoPreview | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);

  // Inline edit sheet: edits a card's content (url/note) or its optional note
  // (file kinds). Replaces the old Alert.alert one-offs.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // On-device curation toggle + model-on-disk readiness.
  const { data: llmSettings } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: getLlmSettings,
  });
  const { data: llmReadyData, isSuccess: llmReadyIsSuccess } = useQuery({
    queryKey: ["llm-model-ready", llmSettings?.modelId],
    queryFn: () => isModelReady(llmSettings!.modelId),
    enabled: Boolean(llmSettings?.modelId),
  });
  const curationOn = llmSettings?.onDeviceCuration === true;
  const { data: usage } = useAiUsage();

  async function toggleCuration(value: boolean) {
    await updateLlmSettings({ onDeviceCuration: value });
    queryClient.invalidateQueries({ queryKey: ["llm-settings"] });
  }

  useEffect(() => {
    apiGet<{ items: { id: string; title: string }[] }>(
      "/api/app/projects?status=active&limit=50",
    )
      .then((page) => setProjects(page.items))
      .catch(() => {});
  }, []);

  // Derived tray error state from the SHARED validators (validateItem already
  // ran per item; deriveTrayErrors layers in-tray dedup + the §4 collapse).
  const trayErrors = useMemo(() => deriveTrayErrors(items), [items]);

  // Photo cards are grouped as ONE SIGHT batch — badge only the first so the
  // group reads as a single SIGHT post even though each card is independent.
  const firstImageId = useMemo(
    () => items.find((i) => i.kind === "image")?.id,
    [items],
  );

  const countLabel = useMemo(() => {
    if (items.length === 0) return "Tray empty";
    const fix = trayErrors.summaries.length
      ? `, ${countToFix(items, trayErrors)} need attention`
      : "";
    return `${items.length} item${items.length === 1 ? "" : "s"} in tray${fix}`;
  }, [items, trayErrors]);

  // Append classified items + announce a summarized utterance (one per gesture).
  function appendItems(next: ClassifiedItem[], announce: string) {
    if (next.length === 0) return;
    setItems((prev) => [...prev, ...next]);
    AccessibilityInfo.announceForAccessibility(announce);
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setNotesById((prev) => {
      if (!prev.has(id)) return prev;
      const copy = new Map(prev);
      copy.delete(id);
      return copy;
    });
    setRegistry((prev) => {
      const asset = prev.get(id);
      if (!asset) return prev;
      void discardStagedCopy(asset.uri);
      const copy = new Map(prev);
      copy.delete(id);
      return copy;
    });
  }

  // Commit the omni text field: classifyText (package) → N url cards + ≤1 note.
  function commitOmniText() {
    const raw = omniText.trim();
    if (raw.length === 0) return;
    const { items: next, deduped, capped } = classifyText(raw);
    if (next.length === 0) {
      setOmniText("");
      return;
    }
    const urls = next.filter((i) => i.kind === "url").length;
    const notes = next.filter((i) => i.kind === "note").length;
    const parts: string[] = [];
    if (urls > 0) parts.push(`${urls} link${urls === 1 ? "" : "s"}`);
    if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
    appendItems(next, `Added ${parts.join(" and ")}.`);
    setOmniText("");
    if (deduped > 0 || capped > 0) {
      const msg: string[] = [];
      if (deduped > 0)
        msg.push(`${deduped} duplicate${deduped === 1 ? "" : "s"} skipped`);
      if (capped > 0) msg.push(`${capped} over the limit dropped`);
      AccessibilityInfo.announceForAccessibility(msg.join(", "));
    }
  }

  // Stage assets durably (outbox copy), register each, classify by descriptor
  // (package), and append. One utterance summarizing the gesture.
  async function stageAndAddAssets(assets: RnAsset[]) {
    if (assets.length === 0) return;
    const classified: ClassifiedItem[] = [];
    const staged: [string, RnAsset][] = [];
    for (const asset of assets) {
      // Copy bytes into the durable outbox so the uri survives; rewrite the
      // asset's uri to the durable path before registering.
      const uri = await stageBinaryCopy(asset.uri, asset.name);
      const durable: RnAsset = { ...asset, uri };
      const item = classifyFile(descriptorFromAsset(durable));
      staged.push([item.id, durable]);
      classified.push(item);
    }
    setRegistry((prev) => {
      const copy = new Map(prev);
      for (const [id, asset] of staged) copy.set(id, asset);
      return copy;
    });
    const byKind = new Map<IngestKind, number>();
    for (const c of classified)
      byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    const parts = Array.from(byKind).map(
      ([k, n]) => `${n} ${pluralKind(k, n)}`,
    );
    appendItems(classified, `Added ${parts.join(" and ")}.`);
  }

  // Override a card's kind via the shared overrideKind (re-derives tag/platform
  // and re-validates). On a file→file override, drop any platform; on text
  // overrides the registry entry is irrelevant.
  function onOverride(id: string, to: IngestKind) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? overrideKind(i, to) : i)),
    );
    AccessibilityInfo.announceForAccessibility("Type changed.");
  }

  // ── Inline edit ────────────────────────────────────────────────────────────
  function openEdit(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const seed =
      item.kind === "url"
        ? (item.url ?? item.content)
        : item.kind === "note"
          ? (item.text ?? item.content)
          : (notesById.get(id) ?? "");
    setEditDraft(seed);
    setEditingId(id);
  }

  function confirmEdit() {
    if (!editingId) return;
    const id = editingId;
    const item = items.find((i) => i.id === id);
    if (!item) {
      setEditingId(null);
      return;
    }
    const value = editDraft;
    if (item.kind === "url") {
      // Re-derive the card from the edited URL via the package: rebuild the
      // url payload + re-validate (a fixed link clears the critical error).
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i;
          const next: ClassifiedItem = {
            ...i,
            content: value.trim(),
            url: value.trim(),
            platform: platformFor(value.trim()),
          };
          const errors = validateItem(next);
          return { ...next, errors, error: errors[0] };
        }),
      );
    } else if (item.kind === "note") {
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i;
          const next: ClassifiedItem = {
            ...i,
            content: value.trim(),
            text: value.trim(),
          };
          const errors = validateItem(next);
          return { ...next, errors, error: errors[0] };
        }),
      );
    } else {
      // File kind: the edit is the optional note, not the content.
      setNotesById((prev) => {
        const copy = new Map(prev);
        const trimmed = value.trim();
        if (trimmed) copy.set(id, trimmed);
        else copy.delete(id);
        return copy;
      });
    }
    AccessibilityInfo.announceForAccessibility("Updated.");
    setEditingId(null);
    setEditDraft("");
  }

  // ── Native pickers (funnel into stageAndAddAssets) ──────────────────────────
  function runAfterMediaSheet(action: () => void) {
    if (Platform.OS === "ios") {
      pendingMediaAction.current = action;
      setMediaSheet(null);
    } else {
      setMediaSheet(null);
      action();
    }
  }

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach images.",
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
    await stageAndAddAssets(
      result.assets.map((asset, i) => assetOf(asset, `img-${i}.jpg`, "image/jpeg")),
    );
  }

  async function pickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Permission needed",
        "Allow photo library access in Settings to attach a video.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    await stageAndAddAssets([assetOf(result.assets[0]!, "video.mp4", "video/mp4")]);
  }

  async function capturePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera permission needed",
        "Allow camera access in Settings to take a photo.",
      );
      return;
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
    } catch {
      Alert.alert(
        "Camera unavailable",
        "Couldn't open the camera. Try again, or choose a photo from your library.",
      );
      return;
    }
    if (result.canceled || result.assets.length === 0) return;
    await stageAndAddAssets([
      assetOf(result.assets[0]!, nextCaptureName("photo", "jpg"), "image/jpeg"),
    ]);
  }

  async function captureVideo() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera permission needed",
        "Allow camera access in Settings to record a video.",
      );
      return;
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["videos"],
        quality: 1,
      });
    } catch {
      Alert.alert(
        "Camera unavailable",
        "Couldn't open the camera. Try again, or choose a video from your library.",
      );
      return;
    }
    if (result.canceled || result.assets.length === 0) return;
    await stageAndAddAssets([
      assetOf(result.assets[0]!, nextCaptureName("video", "mp4"), "video/mp4"),
    ]);
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const a = result.assets[0]!;
    await stageAndAddAssets([
      {
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? "application/pdf",
        size: a.size ?? 0,
      },
    ]);
  }

  async function startRecording() {
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      Alert.alert(
        "Microphone permission needed",
        "Allow microphone access in Settings to record voice memos.",
      );
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
    setIsRecording(true);
  }

  async function stopRecording() {
    await audioRecorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    setIsRecording(false);
    const uri = audioRecorder.uri;
    if (!uri) return;
    setAudioSheetOpen(false);
    await stageAndAddAssets([
      {
        uri,
        name: nextCaptureName("voice-memo", "m4a"),
        mimeType: "audio/x-m4a",
        size: 0,
      },
    ]);
  }

  async function pickAudioFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/aac",
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const a = result.assets[0]!;
    setAudioSheetOpen(false);
    await stageAndAddAssets([
      {
        uri: a.uri,
        name: a.name,
        mimeType: a.mimeType ?? "audio/mpeg",
        size: a.size ?? 0,
      },
    ]);
  }

  // ── Repo sheet (server-side preview, then a url card) ──────────────────────
  async function runRepoPreview() {
    const url = repoUrl.trim();
    if (url.length === 0) {
      setRepoError("Paste a GitHub repository URL first.");
      return;
    }
    setRepoLoading(true);
    setRepoError(null);
    setRepoPreview(null);
    try {
      const { preview } = await apiPostJson<{ preview: RepoPreview }>(
        "/api/app/github/preview",
        { url },
      );
      setRepoPreview(preview);
    } catch (err) {
      setRepoError(
        err instanceof ApiError ? err.message : "Network error reaching preview.",
      );
    } finally {
      setRepoLoading(false);
    }
  }

  function confirmRepo() {
    if (!repoPreview) return;
    // Classify the repo URL through the package so it lands as a url card with
    // the cosmetic `repository` platform pill (the worker still routes by host).
    const { items: next } = classifyText(repoPreview.htmlUrl);
    appendItems(next, "Added 1 repository link.");
    setRepoSheetOpen(false);
    setRepoUrl("");
    setRepoPreview(null);
    setRepoError(null);
  }

  // ── Submit (FROZEN path; only the tray→Material mapping is new) ─────────────
  // Run the frozen submit path for a set of materials with the current session
  // options (focus/audience/curation). Busy is always reset; the result carries
  // submitted/queued/failed/deduped for the caller to act on.
  async function runSubmit(
    toSubmit: Material[],
    force: boolean,
  ): Promise<SubmitMaterialsResult> {
    setBusy(true);
    try {
      return await submitMaterials(toSubmit, {
        force,
        projectId: projectId ?? undefined,
        visibility: audience.visibility,
        shareGroupIds: audience.groupIds,
        onDeviceCuration: curationOn && llmReadyData === true,
      });
    } finally {
      setBusy(false);
    }
  }

  // Clear the tray + session pickers and route to the Catalog after a submit.
  function finishSubmit(queued: number) {
    if (queued > 0) {
      Alert.alert(
        "Saved on this device",
        `${queued} item${queued === 1 ? "" : "s"} queued — they'll finish uploading automatically when you're back online.`,
      );
    }
    setItems([]);
    setNotesById(new Map());
    setRegistry(new Map());
    setProjectId(null);
    setAudience(DEFAULT_AUDIENCE);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    router.push("/(tabs)/library");
  }

  // Force a fresh post for items the server deduped, then finish the flow.
  async function forceReprocess(dupes: Material[]) {
    const result = await runSubmit(dupes, true);
    kickSync("submit");
    if (result.errors.length > 0) {
      Alert.alert("Some submissions failed", result.errors.join("\n\n"));
    }
    finishSubmit(result.queued);
  }

  async function submit() {
    if (busy || items.length === 0 || trayErrors.hasCritical) return;
    const willUseServerAI = !(curationOn && llmReadyData === true);
    if (
      willUseServerAI &&
      usage &&
      !usage.isPro &&
      (usage.remaining ?? 0) <= 0
    ) {
      const becamePro = await presentPaywall();
      if (becamePro) {
        queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      }
    }
    // Pair each Material with its source card id so a per-item failure (matched
    // by Material reference) maps back to the exact card to keep staged.
    const pairs = toMaterialPairs(items, registry, notesById);
    const result = await runSubmit(
      pairs.map((p) => p.material),
      false,
    );
    kickSync("submit");

    if (result.errors.length > 0) {
      // Keep only the cards whose mapped Material failed; clear what submitted.
      const failedSet = new Set<Material>(result.failed);
      const keptIds = new Set(
        pairs.filter((p) => failedSet.has(p.material)).map((p) => p.id),
      );
      setItems((prev) => prev.filter((i) => keptIds.has(i.id)));
      Alert.alert("Some submissions failed", result.errors.join("\n\n"));
      return;
    }

    // The server already had some (or all) of these — content-hash dedup created
    // nothing new, so they aren't queued. Offer a forced re-process rather than
    // silently navigating away as if everything went through.
    if (result.deduped.length > 0) {
      const dupes = result.deduped;
      const n = dupes.length;
      Alert.alert(
        "Already in your catalog",
        `${n === 1 ? "1 item was" : `${n} items were`} already shared, so ${
          n === 1 ? "it wasn't" : "they weren't"
        } queued again. Process again to create a fresh post?`,
        [
          { text: "Process again", onPress: () => void forceReprocess(dupes) },
          {
            text: "Skip",
            style: "cancel",
            onPress: () => finishSubmit(result.queued),
          },
        ],
      );
      return;
    }

    finishSubmit(result.queued);
  }

  const editingItem = editingId
    ? items.find((i) => i.id === editingId)
    : undefined;

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
            <Title accent="." accessibilityRole="header">
              Capture
            </Title>
          </View>

          {/* ── OmniInput ──────────────────────────────────────────────── */}
          <View
            style={styles.omni}
            accessibilityLabel="Omni input. Paste links, type a note, or attach a file."
          >
            <Field
              style={styles.omniInput}
              placeholder={
                "Paste a link or write a note…\nMultiple links split into separate cards."
              }
              multiline
              autoCapitalize="sentences"
              autoCorrect
              value={omniText}
              onChangeText={setOmniText}
              accessibilityLabel="Paste links or type a note"
            />
            {/* iOS multiline TextInputs trap the keyboard (no return dismiss, no
                inputAccessoryView) — this shows only while the keyboard is up and
                dismisses it so a long note never hides behind it. */}
            <KeyboardDoneButton style={styles.keyboardDone} />
            <View style={styles.omniActions}>
              <PrimaryButton
                label="Add"
                onPress={commitOmniText}
                disabled={busy || omniText.trim().length === 0}
                style={styles.omniAdd}
              />
            </View>
            <View style={styles.tapTargets}>
              <ActionCard
                label="Photos"
                symbol="photo.on.rectangle"
                glyph="▦"
                disabled={busy}
                accessibilityHint="Take a photo or pick from your library"
                onPress={() => setMediaSheet("photo")}
              />
              <ActionCard
                label="Video"
                symbol="video"
                glyph="▶"
                disabled={busy}
                accessibilityHint="Record or pick a video"
                onPress={() => setMediaSheet("video")}
              />
              <ActionCard
                label="Files"
                symbol="doc.text"
                glyph="📄"
                disabled={busy}
                accessibilityHint="Pick a PDF or Word document"
                onPress={() => void pickDocument()}
              />
            </View>
            <View style={styles.tapTargets}>
              <ActionCard
                label="Audio"
                symbol="waveform"
                glyph="🎙"
                disabled={busy}
                accessibilityHint="Record a voice memo or pick an audio file"
                onPress={() => setAudioSheetOpen(true)}
              />
              <ActionCard
                label="Repo"
                symbol="chevron.left.forwardslash.chevron.right"
                glyph="◆"
                disabled={busy}
                accessibilityHint="Paste a GitHub repo URL and preview it"
                onPress={() => {
                  setRepoUrl("");
                  setRepoPreview(null);
                  setRepoError(null);
                  setRepoSheetOpen(true);
                }}
              />
              <View style={styles.flex} />
            </View>
            <Text style={styles.shareHint}>
              Tip: share anything to Sirius from another app&apos;s share sheet.
            </Text>
            <TextLink
              label="How it works →"
              tone={t.color.accent}
              onPress={() => router.push("/help")}
            />
          </View>

          {/* ── StagingTray (revealed once something is added) ──────────── */}
          {items.length > 0 ? (
            <View style={styles.trayBlock}>
              <TrayHeader
                count={items.length}
                toFix={countToFix(items, trayErrors)}
                liveLabel={countLabel}
              />
              <TrayErrorSummary summaries={trayErrors.summaries} />
              <View style={styles.trayList}>
                {items.map((item) => (
                  <SmartCard
                    key={item.id}
                    item={item}
                    errors={trayErrors.byId.get(item.id) ?? []}
                    collapsedCodes={trayErrors.collapsedCodes}
                    thumbUri={
                      item.kind === "image"
                        ? registry.get(item.id)?.uri
                        : undefined
                    }
                    sightBadge={item.kind === "image" && item.id === firstImageId}
                    onEdit={() => openEdit(item.id)}
                    onOverride={(to) => onOverride(item.id, to)}
                    onRemove={() => removeItem(item.id)}
                    disabled={busy}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* ── Refine & send: focus / audience / privacy / on-device only
              reveal once the tray has something, so the rest state stays a
              single input. All controls + their handlers are unchanged. ─── */}
          {items.length > 0 ? (
            <View style={styles.refineSection}>
              <Eyebrow>Refine &amp; send</Eyebrow>

              {/* Focus / Visibility (session-level, unchanged) */}
              {projects.length > 0 ? (
                <View style={styles.picker}>
                  <Eyebrow>Focus</Eyebrow>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.pickerScroll}
                  >
                    {[{ id: null, title: "None" }, ...projects].map((p) => (
                      <Pressable
                        key={p.id ?? "__none__"}
                        style={({ pressed }) => [
                          styles.chip,
                          projectId === p.id && styles.chipActive,
                          pressed && styles.chipPressed,
                        ]}
                        onPress={() => setProjectId(p.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Focus: ${p.title}`}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            projectId === p.id && styles.chipTextActive,
                          ]}
                        >
                          {p.title}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <TextLink
                    label="Manage focus →"
                    tone={t.color.accent}
                    onPress={() => router.push("/focus")}
                  />
                </View>
              ) : (
                <View style={styles.pickerEmpty}>
                  <Eyebrow>Focus</Eyebrow>
                  <Text style={styles.pickerEmptyText}>No focus areas yet.</Text>
                  <TextLink
                    label="Create your first focus area →"
                    tone={t.color.accent}
                    onPress={() => router.push("/focus")}
                  />
                </View>
              )}

              {/* Audience */}
              <View style={styles.picker}>
                <Eyebrow>Audience</Eyebrow>
                <Pressable
                  onPress={() => setAudienceOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Audience: ${describeAudience(audience, groups)}. Tap to change.`}
                  style={({ pressed }) => [
                    styles.audienceRow,
                    pressed && styles.audiencePressed,
                  ]}
                >
                  <Text style={styles.audienceValue}>
                    {describeAudience(audience, groups)}
                  </Text>
                  <Text style={styles.audienceEdit}>Edit ▸</Text>
                </Pressable>
              </View>

              {/* On-device drafting toggle (unchanged gating). */}
              {ON_DEVICE_AI_ENABLED && llmReadyData === true ? (
                <View style={styles.curationRow}>
                  <View style={styles.curationCopy}>
                    <Text style={styles.curationLabel}>Draft on device</Text>
                    <Text style={styles.curationHint}>
                      Notes are written privately by the local model.
                    </Text>
                    <TextLink
                      label="On-device AI →"
                      tone={t.color.accent}
                      onPress={() => router.push("/llm")}
                    />
                  </View>
                  <Switch
                    value={curationOn}
                    onValueChange={(v) => void toggleCuration(v)}
                    trackColor={{ true: t.color.ink }}
                    accessibilityLabel="Draft on device"
                  />
                </View>
              ) : ON_DEVICE_AI_ENABLED && llmReadyIsSuccess ? (
                <View style={styles.curationRow}>
                  <View style={styles.curationCopy}>
                    <Text style={styles.curationLabel}>On-device AI</Text>
                    <Text style={styles.curationHint}>
                      Download a model to draft privately.
                    </Text>
                    <TextLink
                      label="Get the model →"
                      tone={t.color.accent}
                      onPress={() => router.push("/llm")}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {items.length > 0 && usage && !usage.isPro ? (
        <View style={styles.usageBar}>
          <UsageMeter usage={usage} />
        </View>
      ) : null}

      {/* ── UnifiedActionButton: "Process {N} Items" ──────────────────── */}
      <OmniSubmitBar
        count={items.length}
        disabled={trayErrors.hasCritical}
        busy={busy}
        onSubmit={submit}
      />

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
      <Sheet
        visible={mediaSheet !== null}
        title={mediaSheet === "video" ? "Video" : "Photo"}
        onClose={() => setMediaSheet(null)}
        onDismiss={() => {
          const action = pendingMediaAction.current;
          pendingMediaAction.current = null;
          action?.();
        }}
      >
        <PrimaryButton
          label={mediaSheet === "video" ? "Record video" : "Take photo"}
          onPress={() =>
            runAfterMediaSheet(mediaSheet === "video" ? captureVideo : capturePhoto)
          }
        />
        <PrimaryButton
          label="Choose from library"
          onPress={() =>
            runAfterMediaSheet(mediaSheet === "video" ? pickVideo : pickImages)
          }
          style={styles.sheetSecondaryButton}
        />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={() => setMediaSheet(null)}
          />
        </View>
      </Sheet>

      <Sheet
        visible={audioSheetOpen}
        title="Audio"
        onClose={() => {
          if (!isRecording) setAudioSheetOpen(false);
        }}
      >
        <PrimaryButton
          label={isRecording ? "Stop recording" : "Record voice memo"}
          onPress={isRecording ? stopRecording : startRecording}
        />
        <PrimaryButton
          label="Pick audio file"
          onPress={pickAudioFile}
          disabled={isRecording}
          style={styles.sheetSecondaryButton}
        />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={() => {
              if (!isRecording) setAudioSheetOpen(false);
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={repoSheetOpen}
        title="Add repository"
        onClose={() => {
          if (!repoLoading) setRepoSheetOpen(false);
        }}
      >
        <Field
          label="GitHub repository URL"
          placeholder="https://github.com/owner/repo"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={repoUrl}
          onChangeText={setRepoUrl}
          onSubmitEditing={() => void runRepoPreview()}
        />
        <PrimaryButton
          label="Fetch preview"
          onPress={() => void runRepoPreview()}
          busy={repoLoading}
          disabled={repoUrl.trim().length === 0}
        />
        {repoError ? (
          <Text style={styles.repoError} accessibilityRole="alert">
            {repoError}
          </Text>
        ) : null}
        {repoPreview ? <RepoPreviewCard preview={repoPreview} /> : null}
        {repoPreview ? (
          <PrimaryButton
            label="Add to tray"
            onPress={confirmRepo}
            style={styles.sheetSecondaryButton}
          />
        ) : null}
        <KeyboardDoneButton style={styles.keyboardDone} />
        <View style={styles.sheetCancel}>
          <TextLink
            label="Cancel"
            tone={t.color.inkMuted}
            onPress={() => {
              if (!repoLoading) setRepoSheetOpen(false);
            }}
          />
        </View>
      </Sheet>

      <Sheet
        visible={editingId !== null}
        title={
          editingItem?.kind === "url"
            ? "Edit link"
            : editingItem?.kind === "note"
              ? "Edit note"
              : "Add a note"
        }
        onClose={() => setEditingId(null)}
      >
        {editingItem ? (
          <>
            <Field
              label={
                editingItem.kind === "url"
                  ? "URL"
                  : editingItem.kind === "note"
                    ? "Note"
                    : "Notes (optional)"
              }
              style={styles.editInput}
              placeholder={
                editingItem.kind === "url"
                  ? "https://example.com"
                  : editingItem.kind === "note"
                    ? "Anything to remember…"
                    : "What interests you about this…"
              }
              multiline={editingItem.kind !== "url"}
              autoFocus
              autoCapitalize={editingItem.kind === "url" ? "none" : "sentences"}
              autoCorrect={editingItem.kind !== "url"}
              keyboardType={editingItem.kind === "url" ? "url" : "default"}
              value={editDraft}
              onChangeText={setEditDraft}
            />
            <KeyboardDoneButton style={styles.keyboardDone} />
            <PrimaryButton
              label="Save"
              onPress={confirmEdit}
              disabled={
                editingItem.kind !== "document" &&
                editingItem.kind !== "image" &&
                editingItem.kind !== "video" &&
                editingItem.kind !== "audio" &&
                editDraft.trim().length === 0
              }
            />
            <View style={styles.sheetCancel}>
              <TextLink
                label="Cancel"
                tone={t.color.inkMuted}
                onPress={() => setEditingId(null)}
              />
            </View>
          </>
        ) : null}
      </Sheet>

      <AudienceSheet
        mode="controlled"
        value={audience}
        onChange={setAudience}
        visible={audienceOpen}
        onClose={() => setAudienceOpen(false)}
      />
    </Screen>
  );
}

// Build an RnAsset from an expo-image-picker asset, defaulting name/type/size.
function assetOf(
  asset: ImagePicker.ImagePickerAsset,
  fallbackName: string,
  fallbackType: string,
): RnAsset {
  return {
    uri: asset.uri,
    name: asset.fileName ?? fallbackName,
    mimeType: asset.mimeType ?? fallbackType,
    size: asset.fileSize ?? 0,
  };
}

// Count of cards carrying a critical error (the "N to fix" figure).
function countToFix(
  items: ClassifiedItem[],
  derived: ReturnType<typeof deriveTrayErrors>,
): number {
  let n = 0;
  for (const item of items) {
    const errs = derived.byId.get(item.id) ?? [];
    if (errs.some((e) => e.severity === "critical")) n++;
  }
  return n;
}

function pluralKind(kind: IngestKind, n: number): string {
  const labels: Record<IngestKind, [string, string]> = {
    url: ["link", "links"],
    note: ["note", "notes"],
    image: ["photo", "photos"],
    video: ["video", "videos"],
    audio: ["audio file", "audio files"],
    document: ["document", "documents"],
  };
  const [one, many] = labels[kind];
  return n === 1 ? one : many;
}

// The unified bottom action. Label is EXACTLY "Process {N} Items"; disabled when
// the tray is empty OR any card carries a critical error.
function OmniSubmitBar({
  count,
  disabled,
  busy,
  onSubmit,
}: {
  count: number;
  disabled: boolean;
  busy?: boolean;
  onSubmit: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const empty = count === 0;
  const label = empty
    ? "Add something to begin"
    : `Process ${count} Item${count === 1 ? "" : "s"}`;
  return (
    <View
      style={[
        styles.submitBar,
        { paddingBottom: BottomTabInset + insets.bottom + t.space.md },
      ]}
    >
      <PrimaryButton
        label={busy ? "Processing…" : label}
        onPress={onSubmit}
        busy={busy}
        disabled={empty || disabled}
        style={styles.submitButton}
      />
    </View>
  );
}

// The confirm-preview repo card (unchanged from the prior composer).
function RepoPreviewCard({ preview }: { preview: RepoPreview }) {
  const styles = useThemedStyles(makeStyles);
  const meta = [
    `★ ${preview.stars.toLocaleString()}`,
    preview.primaryLanguage,
    preview.license,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.repoCard}>
      <View style={styles.repoCardHead}>
        {preview.ownerAvatarUrl ? (
          <Image
            source={{ uri: preview.ownerAvatarUrl }}
            style={styles.repoAvatar}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.repoName} numberOfLines={1}>
            {preview.owner}/{preview.repo}
          </Text>
          {preview.description ? (
            <Text style={styles.repoDescription} numberOfLines={2}>
              {preview.description}
            </Text>
          ) : null}
        </View>
      </View>
      {meta.length > 0 ? (
        <Text style={styles.repoMeta}>{meta.join("  ·  ")}</Text>
      ) : null}
      {preview.readmeExcerpt ? (
        <Text style={styles.repoReadme} numberOfLines={4}>
          {preview.readmeExcerpt}
        </Text>
      ) : null}
      {preview.keyFilePaths.length > 0 ? (
        <Text style={styles.repoFiles} numberOfLines={3}>
          Will read {preview.keyFilePaths.length} file
          {preview.keyFilePaths.length === 1 ? "" : "s"}:{" "}
          {preview.keyFilePaths.join(", ")}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    usageBar: {
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.sm,
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderTopColor: t.color.rule,
    },
    container: {
      padding: t.space.xl,
      paddingTop: 64,
      paddingBottom: 220,
      gap: t.space.lg,
    },
    header: { gap: t.space.lg, marginBottom: t.space.xs },

    // OmniInput
    omni: {
      borderWidth: 1,
      borderColor: t.color.ruleStrong,
      borderStyle: "dashed",
      backgroundColor: t.color.paperRaised,
      padding: t.space.lg,
      gap: t.space.md,
    },
    omniInput: {
      minHeight: 96,
      textAlignVertical: "top",
      paddingTop: 12,
      backgroundColor: t.color.paper,
    },
    omniActions: { flexDirection: "row", justifyContent: "flex-end" },
    omniAdd: { paddingHorizontal: t.space.xl },
    tapTargets: { flexDirection: "row", gap: t.space.md },
    shareHint: {
      fontFamily: t.font.serif,
      fontSize: 13,
      fontStyle: "italic",
      color: t.color.inkMuted,
      lineHeight: 18,
    },

    // Pickers
    picker: { gap: t.space.sm },
    pickerScroll: { flexDirection: "row" },
    pickerEmpty: { gap: t.space.sm },
    pickerEmptyText: {
      fontFamily: t.font.serif,
      fontSize: 15,
      fontStyle: "italic",
      color: t.color.inkMuted,
    },
    chip: {
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.xs,
      borderWidth: 1,
      borderColor: t.color.rule,
      marginRight: t.space.sm,
    },
    chipActive: { borderColor: t.color.accent, backgroundColor: t.color.accent },
    chipPressed: { opacity: 0.6 },
    chipText: {
      fontFamily: t.font.serif,
      fontSize: 13,
      color: t.color.inkMuted,
    },
    chipTextActive: { color: t.color.paper },

    // Audience summary row (taps open the AudienceSheet)
    audienceRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: t.color.rule,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      minHeight: 44,
    },
    audiencePressed: { opacity: 0.6 },
    audienceValue: {
      fontFamily: t.font.serif,
      fontSize: 16,
      color: t.color.ink,
      flexShrink: 1,
    },
    audienceEdit: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },

    // Tray
    trayBlock: { gap: t.space.sm },
    trayList: { gap: t.space.sm },

    // Refine & send — the progressively-revealed step. A top hairline rule sets
    // it off as a distinct editorial band below the input + tray.
    refineSection: {
      gap: t.space.lg,
      borderTopWidth: 1,
      borderTopColor: t.color.rule,
      paddingTop: t.space.lg,
    },

    // Curation toggle
    curationRow: {
      alignItems: "center",
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      flexDirection: "row",
      gap: t.space.md,
      justifyContent: "space-between",
      padding: t.space.md,
    },
    curationCopy: { flex: 1, gap: t.space.xs },
    curationLabel: { color: t.color.ink, fontFamily: t.font.serif, fontSize: 16 },
    curationHint: { color: t.color.inkMuted, fontSize: 13 },

    // Submit bar
    submitBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderColor: t.color.ruleStrong,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
    },
    submitButton: { width: "100%" },

    // Sheets
    editInput: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
    keyboardDone: { alignSelf: "flex-end" },
    sheetCancel: { alignItems: "center" },
    sheetSecondaryButton: { marginTop: t.space.sm },
    repoError: { color: t.color.error, fontFamily: t.font.mono, fontSize: 12 },
    repoCard: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      padding: t.space.md,
      gap: t.space.sm,
    },
    repoCardHead: { flexDirection: "row", gap: t.space.md },
    repoAvatar: {
      width: 40,
      height: 40,
      backgroundColor: t.color.paperSunken,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    repoName: { fontFamily: t.font.serif, fontSize: 17, color: t.color.ink },
    repoDescription: {
      fontFamily: t.font.serif,
      fontSize: 14,
      color: t.color.inkMuted,
      marginTop: 2,
    },
    repoMeta: { fontFamily: t.font.mono, fontSize: 12, color: t.color.inkMuted },
    repoReadme: {
      fontFamily: t.font.serif,
      fontSize: 13,
      lineHeight: 20,
      color: t.color.inkMuted,
      borderLeftWidth: 2,
      borderLeftColor: t.color.rule,
      paddingLeft: t.space.sm,
    },
    repoFiles: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
  });
}
