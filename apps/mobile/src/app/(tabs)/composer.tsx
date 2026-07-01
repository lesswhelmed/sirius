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
import { useQueryClient } from "@tanstack/react-query";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import {
  Eyebrow,
  Field,
  KeyboardDoneButton,
  PrimaryButton,
  Screen,
  Sheet,
  TextLink,
  Title,
} from "@/components/sirius";
import { SmartCard, TrayErrorSummary } from "@/components/omni-tray";
import { AudienceSheet } from "@/components/audience-sheet";
import { GlassRow, GlassSurface, glassAvailable } from "@/components/glass-surface";

import { BottomTabInset, type Theme } from "@/constants/theme";
import { useIsDark, useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet, apiPostJson } from "@/lib/api";
import {
  type AudienceValue,
  DEFAULT_AUDIENCE,
  describeAudience,
  useGroups,
} from "@/lib/groups";
import {
  type Material,
  submitMaterials,
  type SubmitMaterialsResult,
} from "@/lib/materials";
import { pushOnce } from "@/lib/nav";
import {
  deriveTrayErrors,
  descriptorFromAsset,
  type FileRegistry,
  type RnAsset,
  toMaterialPairs,
} from "@/lib/omni-ingest";
import { discardStagedCopy, isStagedPath, stageBinaryCopy } from "@/lib/outbox";
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
  const isDark = useIsDark();
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

  // Review & send flow. The tray no longer dumps focus/audience/curation inline;
  // instead a tray bar opens a 2-step wizard (1 = audience, 2 = focus + send) so
  // it's one decision per screen. `itemsSheetOpen` shows the staged cards for
  // edit/remove from the tray bar. `reviewStep` null = wizard closed.
  const [reviewStep, setReviewStep] = useState<null | 1 | 2>(null);
  const [itemsSheetOpen, setItemsSheetOpen] = useState(false);
  // Step 2 is a [FOCUS | NOTE] tabbed screen. `submissionNote` is one optional
  // note for the WHOLE submission (a per-card note overrides it per item); it
  // lives in component state so it survives back/forth nav and is only cleared
  // in finishSubmit.
  const [refineTab, setRefineTab] = useState<"focus" | "note">("focus");
  const [submissionNote, setSubmissionNote] = useState("");

  // Step 2 (focus) search + inline create. `focusQuery` filters the focus list
  // and doubles as the title for a new focus; creating one POSTs to the SAME
  // /api/app/projects endpoint the web app uses, then selects it — the wizard
  // stays open so no staged item/text/audience context is lost.
  const insets = useSafeAreaInsets();
  const focusSearchRef = useRef<TextInput>(null);
  const [focusQuery, setFocusQuery] = useState("");
  const [creatingFocus, setCreatingFocus] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  async function createFocus(rawTitle: string) {
    const title = rawTitle.trim();
    if (title.length === 0 || creatingFocus) return;
    setCreatingFocus(true);
    setFocusError(null);
    try {
      const { project } = await apiPostJson<{
        project: { id: string; title: string };
      }>("/api/app/projects", { title });
      setProjects((prev) => [
        { id: project.id, title: project.title },
        ...prev.filter((p) => p.id !== project.id),
      ]);
      setProjectId(project.id);
      setFocusQuery("");
      focusSearchRef.current?.blur();
    } catch (e) {
      setFocusError(
        e instanceof ApiError ? e.message : "Couldn't create that focus.",
      );
    } finally {
      setCreatingFocus(false);
    }
  }

  // Drafting always runs server-side for now — on-device curation is parked
  // until the feature is solidified, so it's intentionally not surfaced here.
  const { data: usage } = useAiUsage();

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
  // One-tap paste: pull the clipboard string straight into the omni input so the
  // user doesn't have to focus the field + long-press + paste. Appends below any
  // existing text rather than clobbering it. expo-clipboard is cross-platform.
  async function pasteFromClipboard() {
    const clip = (await Clipboard.getStringAsync()).trim();
    if (clip.length === 0) {
      AccessibilityInfo.announceForAccessibility("Clipboard is empty");
      return;
    }
    setOmniText((prev) =>
      prev.trim().length === 0 ? clip : `${prev.replace(/\s+$/, "")}\n${clip}`,
    );
  }

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
    let stageFailures = 0;
    for (const asset of assets) {
      // Copy bytes into the durable outbox so the uri survives; rewrite the
      // asset's uri to the durable path before registering. If the durable copy
      // throws (disk pressure, an evicted picker uri, an aborted copy of a big
      // video), KEEP the capture anyway with its ORIGINAL uri instead of letting
      // the whole add reject — a dropped capture with no feedback is the bug.
      // submit() re-stages kept items while the picker uri is still alive.
      let durable: RnAsset;
      try {
        const uri = await stageBinaryCopy(asset.uri, asset.name);
        durable = { ...asset, uri };
      } catch {
        durable = asset;
        stageFailures += 1;
      }
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
    if (stageFailures > 0) {
      Alert.alert(
        "Added — securing in the background",
        `${stageFailures} file${stageFailures === 1 ? "" : "s"} couldn't be copied to durable storage yet. ${
          stageFailures === 1 ? "It's" : "They're"
        } still in your tray and we'll try again when you submit.`,
      );
    }
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
      result.assets.map((asset, i) =>
        assetOf(asset, `img-${i}.jpg`, "image/jpeg"),
      ),
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
    await stageAndAddAssets([
      assetOf(result.assets[0]!, "video.mp4", "video/mp4"),
    ]);
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
        err instanceof ApiError
          ? err.message
          : "Network error reaching preview.",
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
        onDeviceCuration: false,
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
    setSubmissionNote("");
    setRefineTab("focus");
    setEditingId(null);
    setRegistry(new Map());
    setProjectId(null);
    setAudience(DEFAULT_AUDIENCE);
    setReviewStep(null);
    setItemsSheetOpen(false);
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["posts"] });
    pushOnce("/(tabs)/library");
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
    // Drafting is always server-side now, so the usage cap always applies.
    if (usage && !usage.isPro && (usage.remaining ?? 0) <= 0) {
      const becamePro = await presentPaywall();
      if (becamePro) {
        queryClient.invalidateQueries({ queryKey: ["ai-usage"] });
      }
    }
    // Best-effort: give any capture we kept with its ORIGINAL (un-staged) picker
    // uri a durable outbox copy now, while that uri is still alive (it may be
    // evicted later). A failure here is non-fatal — the enqueue still produces a
    // recoverable In-flight row. Already-staged assets are skipped (no double copy).
    const restaged = new Map(registry);
    for (const [id, asset] of registry) {
      if (isStagedPath(asset.uri)) continue;
      try {
        const uri = await stageBinaryCopy(asset.uri, asset.name);
        restaged.set(id, { ...asset, uri });
      } catch {
        // Leave the original uri in place; submission stays recoverable.
      }
    }
    setRegistry(restaged);
    // Pair each Material with its source card id so a per-item failure (matched
    // by Material reference) maps back to the exact card to keep staged.
    const pairs = toMaterialPairs(items, restaged, notesById, submissionNote);
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

  // Step 2 focus list, filtered by the search box. "Auto" stays pinned at the
  // top unless the query clearly doesn't match it. The create row appears when
  // the query names a focus that doesn't already exist (exact, case-insensitive).
  const focusQ = focusQuery.trim();
  const focusQLower = focusQ.toLowerCase();
  const filteredProjects = focusQLower
    ? projects.filter((p) => p.title.toLowerCase().includes(focusQLower))
    : projects;
  const showAutoRow = focusQLower === "" || "auto".includes(focusQLower);
  const focusExactExists = projects.some(
    (p) => p.title.trim().toLowerCase() === focusQLower,
  );
  const showCreateRow = focusQ === "" || !focusExactExists;

  return (
    <Screen>
      {/* Luminous "void" behind the liquid-glass surfaces — dark theme only,
          where the midnight-navy ground reads as deep space. On paper it's
          omitted so the glow never muddies the warm light theme. */}
      {isDark && glassAvailable ? <VoidBackdrop /> : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.container,
            items.length > 0 && styles.containerTrayPad,
          ]}
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
            {/* Read-only orientation sits up top, out of the thumb zone. */}
            <Text style={styles.shareHint}>
              Tip: share anything to Sirius from another app&apos;s share sheet.
            </Text>
            <TextLink
              label="How it works →"
              tone={t.color.accent}
              onPress={() => pushOnce("/help")}
            />
            {/* Secondary capture kinds — Video / Files / Repo. */}
            <Eyebrow>Attach</Eyebrow>
            <View style={styles.chipRow}>
              <MediaChip
                label="Video"
                symbol="video"
                glyph="▶"
                disabled={busy}
                accessibilityHint="Record or pick a video"
                onPress={() => setMediaSheet("video")}
              />
              <MediaChip
                label="Files"
                symbol="doc.text"
                glyph="📄"
                disabled={busy}
                accessibilityHint="Pick a PDF or Word document"
                onPress={() => void pickDocument()}
              />
              <MediaChip
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
            </View>
            {/* The omni well — a single luminous liquid-glass slab holding the
                input; the "event horizon" everything is pulled into. Falls back
                to the bordered paper field off-glass. The Paste/Add actions now
                live in the reachable FrontAddBar footer below. */}
            <GlassSurface
              glass="regular"
              style={styles.omniWell}
              glassStyle={styles.omniWellGlass}
              fallbackStyle={styles.omniWellFallback}
            >
              <Field
                style={[styles.omniInput, glassAvailable && styles.omniInputGlass]}
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
            </GlassSurface>
            {/* Attachment area — Photos + Audio as two calm side-by-side tiles
                (the primary pair), the reachable bottom band. Handlers unchanged. */}
            <Eyebrow>Add media</Eyebrow>
            <GlassRow spacing={t.space.xl} style={styles.mediaTiles}>
              <MediaTile
                label="Add photos"
                sublabel="Take one or pick"
                symbol="photo.on.rectangle"
                glyph="▦"
                disabled={busy}
                accessibilityHint="Take a photo or pick from your library"
                onPress={() => setMediaSheet("photo")}
              />
              <MediaTile
                label="Record audio"
                sublabel="Capture a voice memo"
                symbol="waveform"
                glyph="🎙"
                disabled={busy}
                accessibilityHint="Record a voice memo or pick an audio file"
                onPress={() => setAudioSheetOpen(true)}
              />
            </GlassRow>
          </View>
        </ScrollView>
        {/* FrontAddBar — the front-screen commit footer (items.length === 0).
            A flow footer INSIDE the KeyboardAvoidingView so it rides above the
            keyboard automatically; swaps with the absolute TrayBar once items
            are staged (mutually exclusive, never co-rendered). */}
        {items.length === 0 ? (
          <FrontAddBar
            busy={busy}
            omniText={omniText}
            onAdd={commitOmniText}
            onPaste={() => void pasteFromClipboard()}
          />
        ) : null}
      </KeyboardAvoidingView>

      {/* ── Tray bar: the ONLY thing that appears once items are staged.
          Tapping the item area reviews/edits the cards; "Review & send"
          opens the 2-step wizard. Replaces the old inline settings wall. ── */}
      {items.length > 0 ? (
        <TrayBar
          count={items.length}
          thumbUri={firstImageId ? registry.get(firstImageId)?.uri : undefined}
          onReview={() => setItemsSheetOpen(true)}
          onSend={() => {
            // One-modal invariant: close the items sheet + any inline edit
            // before presenting the wizard Modal (two RN Modals wedge iOS).
            setEditingId(null);
            setItemsSheetOpen(false);
            setReviewStep(1);
          }}
          disabled={trayErrors.hasCritical}
        />
      ) : null}

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
            runAfterMediaSheet(
              mediaSheet === "video" ? captureVideo : capturePhoto,
            )
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

      {/* (The per-card edit was a standalone Sheet here; it stacked a 2nd Modal
          over the "In tray" Sheet and wedged iOS. Edit is now inline in the tray
          list above — see the editingId === item.id branch.) */}

      <AudienceSheet
        mode="controlled"
        value={audience}
        onChange={setAudience}
        visible={audienceOpen}
        onClose={() => setAudienceOpen(false)}
      />

      {/* Items review — the staged cards, for edit / change-type / remove.
          Edit is INLINE (swaps the card for a Field) — never a second Modal,
          which would stack over this Sheet and wedge iOS. */}
      <Sheet
        visible={itemsSheetOpen}
        title="In tray"
        onClose={() => {
          setEditingId(null);
          setItemsSheetOpen(false);
        }}
      >
        <TrayErrorSummary summaries={trayErrors.summaries} />
        {items.length === 0 ? (
          <Text style={styles.pickerEmptyText}>Your tray is empty.</Text>
        ) : (
          <View style={styles.trayList}>
            {items.map((item) =>
              editingId === item.id ? (
                // Inline edit row (replaces the card). Same kind-derived Field as
                // the old edit sheet; url/text re-validate, file kinds write the
                // per-card note. confirmEdit clears editingId → back to the card.
                <GlassSurface
                  key={item.id}
                  glass="regular"
                  style={styles.trayEditRow}
                  glassStyle={styles.trayEditRowGlass}
                  fallbackStyle={styles.trayEditRowFallback}
                >
                  <Field
                    label={
                      item.kind === "url"
                        ? "URL"
                        : item.kind === "note"
                          ? "Note"
                          : "Notes (optional)"
                    }
                    style={styles.editInput}
                    placeholder={
                      item.kind === "url"
                        ? "https://example.com"
                        : item.kind === "note"
                          ? "Anything to remember…"
                          : "What interests you about this…"
                    }
                    multiline={item.kind !== "url"}
                    autoFocus
                    autoCapitalize={item.kind === "url" ? "none" : "sentences"}
                    autoCorrect={item.kind !== "url"}
                    keyboardType={item.kind === "url" ? "url" : "default"}
                    value={editDraft}
                    onChangeText={setEditDraft}
                  />
                  <KeyboardDoneButton style={styles.keyboardDone} />
                  <View style={styles.trayEditActions}>
                    <TextLink
                      label="Cancel"
                      tone={t.color.inkMuted}
                      onPress={() => {
                        setEditingId(null);
                        setEditDraft("");
                      }}
                    />
                    <PrimaryButton
                      label="Save"
                      onPress={confirmEdit}
                      disabled={
                        item.kind !== "document" &&
                        item.kind !== "image" &&
                        item.kind !== "video" &&
                        item.kind !== "audio" &&
                        editDraft.trim().length === 0
                      }
                    />
                  </View>
                </GlassSurface>
              ) : (
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
              ),
            )}
          </View>
        )}
      </Sheet>

      {/* ── Review & send wizard: one decision per screen ───────────────── */}
      <Modal
        visible={reviewStep !== null}
        animationType="slide"
        onRequestClose={() => setReviewStep(null)}
      >
        <Screen>
          <View
            style={[styles.wizHeader, { paddingTop: insets.top + t.space.sm }]}
          >
            <Pressable
              onPress={() =>
                reviewStep === 2 ? setReviewStep(1) : setReviewStep(null)
              }
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={reviewStep === 2 ? "Back" : "Close"}
              style={({ pressed }) => [
                styles.wizBack,
                pressed && styles.audiencePressed,
              ]}
            >
              <SymbolView
                name={reviewStep === 2 ? "chevron.left" : "xmark"}
                size={20}
                tintColor={t.color.ink}
                fallback={
                  <Text style={styles.wizBackGlyph}>
                    {reviewStep === 2 ? "‹" : "✕"}
                  </Text>
                }
              />
            </Pressable>
            <View style={styles.wizStep}>
              <Text style={styles.wizStepText}>Step {reviewStep} / 2</Text>
              <View style={styles.dots}>
                <View style={[styles.dot, styles.dotOn]} />
                <View style={[styles.dot, reviewStep === 2 && styles.dotOn]} />
              </View>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.wizBody}
            keyboardShouldPersistTaps="handled"
          >
            {reviewStep === 1 ? (
              <>
                <Title accent="." accessibilityRole="header">
                  Who can see this
                </Title>
                <Text style={styles.wizHelper}>
                  You can change this anytime from the post.
                </Text>
                <GlassSurface
                  glass="regular"
                  style={styles.audCard}
                  glassStyle={styles.audCardGlass}
                  fallbackStyle={styles.audCardFallback}
                >
                  {(["PRIVATE", "FRIENDS", "PUBLIC"] as const).map((v) => {
                  const meta = AUDIENCE_META[v];
                  const selected = audience.visibility === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() =>
                        setAudience({ visibility: v, groupIds: [] })
                      }
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${meta.label}. ${meta.sub}.`}
                      style={({ pressed }) => [
                        styles.audRow,
                        pressed && styles.audiencePressed,
                      ]}
                    >
                      <View style={styles.audText}>
                        <Text style={styles.audLabel}>{meta.label}</Text>
                        <Text style={styles.audSub}>{meta.sub}</Text>
                      </View>
                      <View
                        style={[styles.radio, selected && styles.radioOn]}
                      />
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setAudienceOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Share with named groups"
                  style={({ pressed }) => [
                    styles.audRow,
                    pressed && styles.audiencePressed,
                  ]}
                >
                  <View style={styles.audText}>
                    <Text style={styles.audLabel}>Groups…</Text>
                    <Text style={styles.audSub}>
                      {audience.visibility === "GROUP"
                        ? describeAudience(audience, groups)
                        : "Share with named groups"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      audience.visibility === "GROUP" && styles.radioOn,
                    ]}
                  />
                </Pressable>
                </GlassSurface>
              </>
            ) : (
              <>
                {/* [ FOCUS | NOTE ] — two whole-submission decisions, one screen. */}
                <GlassSurface
                  glass="clear"
                  style={styles.segmented}
                  glassStyle={styles.segmentedGlass}
                  fallbackStyle={styles.segmentedFallback}
                >
                  {(["focus", "note"] as const).map((tab) => (
                    <Pressable
                      key={tab}
                      onPress={() => setRefineTab(tab)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: refineTab === tab }}
                      accessibilityLabel={tab === "focus" ? "Focus" : "Note"}
                      style={[
                        styles.segment,
                        glassAvailable && styles.segmentGlass,
                        refineTab === tab && styles.segmentOn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          refineTab === tab && styles.segmentTextOn,
                        ]}
                      >
                        {tab === "focus" ? "FOCUS" : "NOTE"}
                      </Text>
                    </Pressable>
                  ))}
                </GlassSurface>

                {refineTab === "note" ? (
                  <>
                    <Title accent="." accessibilityRole="header">
                      Add a note
                    </Title>
                    <Text style={styles.wizHelper}>
                      One note for everything in this batch — what caught your
                      eye, why it matters. A per-card note overrides it.
                      Optional.
                    </Text>
                    <GlassSurface
                      glass="regular"
                      style={styles.noteWell}
                      glassStyle={styles.noteWellGlass}
                      fallbackStyle={styles.noteWellFallback}
                    >
                      <TextInput
                        style={styles.noteArea}
                        value={submissionNote}
                        onChangeText={setSubmissionNote}
                        placeholder="What interests you about this…"
                        placeholderTextColor={t.color.inkSubtle}
                        selectionColor={t.color.accent}
                        multiline
                        textAlignVertical="top"
                        autoCapitalize="sentences"
                        accessibilityLabel="Note for this submission"
                      />
                    </GlassSurface>
                    <KeyboardDoneButton style={styles.keyboardDone} />
                  </>
                ) : null}

                {refineTab === "focus" ? (
                  <>
                    <Title accent="." accessibilityRole="header">
                      File it under
                    </Title>
                    <Text style={styles.wizHelper}>
                      Pick a focus, or let Sirius file it automatically.
                    </Text>

                    {/* Search box doubles as the new-focus title. */}
                    <GlassSurface
                      glass="clear"
                      style={styles.focusSearch}
                      glassStyle={styles.focusSearchGlass}
                      fallbackStyle={styles.focusSearchFallback}
                    >
                      <SymbolView
                        name="magnifyingglass"
                        size={16}
                        tintColor={t.color.inkMuted}
                        fallback={
                          <Text style={styles.focusSearchGlyph}>⌕</Text>
                        }
                      />
                      <TextInput
                        ref={focusSearchRef}
                        style={styles.focusSearchInput}
                        value={focusQuery}
                        onChangeText={(text) => {
                          setFocusQuery(text);
                          if (focusError) setFocusError(null);
                        }}
                        placeholder="Search or create a focus…"
                        placeholderTextColor={t.color.inkSubtle}
                        selectionColor={t.color.accent}
                        autoCapitalize="sentences"
                        autoCorrect={false}
                        returnKeyType="search"
                        accessibilityLabel="Search or create a focus"
                      />
                      {focusQuery.length > 0 ? (
                        <Pressable
                          onPress={() => setFocusQuery("")}
                          hitSlop={10}
                          accessibilityRole="button"
                          accessibilityLabel="Clear search"
                        >
                          <Text style={styles.focusSearchClear}>✕</Text>
                        </Pressable>
                      ) : null}
                    </GlassSurface>

                    {/* Auto — the recommended default. */}
                    {showAutoRow ? (
                      <Pressable
                        onPress={() => setProjectId(null)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: projectId === null }}
                        accessibilityLabel="Auto. Sirius picks the best focus for you. Recommended."
                        style={({ pressed }) => [
                          styles.audRow,
                          pressed && styles.audiencePressed,
                        ]}
                      >
                        <View style={styles.audText}>
                          <View style={styles.focusAutoHead}>
                            <Text style={styles.audLabel}>Auto</Text>
                            <Text style={styles.focusRecTag}>RECOMMENDED</Text>
                          </View>
                          <Text style={styles.audSub}>
                            Sirius picks the best focus for you
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            projectId === null && styles.radioOn,
                          ]}
                        />
                      </Pressable>
                    ) : null}

                    {/* Existing focus areas, filtered by the search box. */}
                    {filteredProjects.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() => setProjectId(p.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: projectId === p.id }}
                        accessibilityLabel={`Focus: ${p.title}`}
                        style={({ pressed }) => [
                          styles.audRow,
                          pressed && styles.audiencePressed,
                        ]}
                      >
                        <View style={styles.audText}>
                          <Text style={styles.audLabel}>{p.title}</Text>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            projectId === p.id && styles.radioOn,
                          ]}
                        />
                      </Pressable>
                    ))}

                    {!showAutoRow &&
                    filteredProjects.length === 0 &&
                    !showCreateRow ? (
                      <Text style={styles.pickerEmptyText}>No matches.</Text>
                    ) : null}

                    {/* Create a new focus inline (POSTs to /api/app/projects). */}
                    {showCreateRow ? (
                      <Pressable
                        onPress={() => {
                          if (focusQ.length > 0) void createFocus(focusQuery);
                          else focusSearchRef.current?.focus();
                        }}
                        disabled={creatingFocus}
                        accessibilityRole="button"
                        accessibilityLabel={
                          focusQ.length > 0
                            ? `Create focus ${focusQ}`
                            : "Create a new focus"
                        }
                        style={({ pressed }) => [
                          styles.focusCreateRow,
                          pressed && styles.audiencePressed,
                        ]}
                      >
                        <Text style={styles.focusCreatePlus}>＋</Text>
                        <Text style={styles.focusCreateLabel}>
                          {creatingFocus
                            ? "Creating…"
                            : focusQ.length > 0
                              ? `Create “${focusQ}”`
                              : "Create a new focus"}
                        </Text>
                      </Pressable>
                    ) : null}

                    {focusError ? (
                      <Text style={styles.repoError} accessibilityRole="alert">
                        {focusError}
                      </Text>
                    ) : null}

                    <TextLink
                      label="Manage focus →"
                      tone={t.color.accent}
                      onPress={() => pushOnce("/focus")}
                    />
                  </>
                ) : null}
              </>
            )}
          </ScrollView>

          <View
            style={[
              styles.wizFooter,
              { paddingBottom: insets.bottom + t.space.md },
            ]}
          >
            {reviewStep === 1 ? (
              <PrimaryButton
                label="Next →"
                onPress={() => setReviewStep(2)}
                style={styles.submitButton}
              />
            ) : (
              <>
                {usage && !usage.isPro ? <UsageMeter usage={usage} /> : null}
                <PrimaryButton
                  label={
                    busy
                      ? "Processing…"
                      : `Process ${items.length} item${items.length === 1 ? "" : "s"}`
                  }
                  onPress={submit}
                  busy={busy}
                  disabled={trayErrors.hasCritical}
                  style={styles.submitButton}
                />
              </>
            )}
          </View>
        </Screen>
      </Modal>
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

// The luminous "void" painted behind the liquid-glass surfaces (dark theme +
// glass only). No gradient/blur libs are installed, so each bloom is a stack of
// concentric low-alpha circles that fake a soft radial falloff — a sage-gold
// orb high (behind the omni well) and a cooler steel orb low. pointerEvents off
// so it never intercepts touches meant for the content above it.
function VoidBackdrop() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View pointerEvents="none" style={styles.voidWrap} accessibilityElementsHidden>
      <View style={[styles.bloom, styles.bloomSageOuter]} />
      <View style={[styles.bloom, styles.bloomSageMid]} />
      <View style={[styles.bloom, styles.bloomSageCore]} />
      <View style={[styles.bloom, styles.bloomSteelOuter]} />
      <View style={[styles.bloom, styles.bloomSteelCore]} />
    </View>
  );
}

// A wide, short "hero" attachment action: framed/plain icon on the left, a serif
// title + muted subtitle to its right. `primary` paints the border with the
// accent (the standout action); `framed` boxes the icon in an accent outline.
// A primary attachment tile: icon over a serif label + a tiny mono sub-caption,
// hairline border. Photos + Audio sit as an equal-width pair — calmer than the
// old full-width hero rows but still the top tier above the secondary chips.
function MediaTile({
  label,
  sublabel,
  symbol,
  glyph,
  disabled,
  accessibilityHint,
  onPress,
}: {
  label: string;
  sublabel: string;
  symbol: SFSymbol;
  glyph: string;
  disabled?: boolean;
  accessibilityHint?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassSurface
      glass="regular"
      isInteractive
      style={styles.mediaTile}
      glassStyle={styles.mediaTileGlass}
      fallbackStyle={styles.mediaTileFallback}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.mediaTilePress,
          pressed && (glassAvailable ? styles.glassPressed : styles.heroPressed),
        ]}
      >
        <SymbolView
          name={symbol}
          size={24}
          weight="regular"
          tintColor={t.color.ink}
          fallback={
            <Text style={styles.mediaTileGlyph} accessibilityElementsHidden>
              {glyph}
            </Text>
          }
        />
        <Text style={styles.mediaTileLabel}>{label}</Text>
        <Text style={styles.mediaTileSub}>{sublabel}</Text>
      </Pressable>
    </GlassSurface>
  );
}

// A compact attachment chip: centered icon + mono label, hairline border. Sits
// in a row of equal-width chips for the secondary media kinds.
function MediaChip({
  label,
  symbol,
  glyph,
  disabled,
  accessibilityHint,
  onPress,
}: {
  label: string;
  symbol: SFSymbol;
  glyph: string;
  disabled?: boolean;
  accessibilityHint?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <GlassSurface
      glass="clear"
      isInteractive
      style={styles.mediaChip}
      glassStyle={styles.mediaChipGlass}
      fallbackStyle={styles.mediaChipFallback}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.mediaChipPress,
          pressed && (glassAvailable ? styles.glassPressed : styles.heroPressed),
        ]}
      >
        <SymbolView
          name={symbol}
          size={16}
          weight="regular"
          tintColor={t.color.ink}
          fallback={
            <Text style={styles.mediaChipGlyph} accessibilityElementsHidden>
              {glyph}
            </Text>
          }
        />
        <Text style={styles.mediaChipLabel}>{label}</Text>
      </Pressable>
    </GlassSurface>
  );
}

// Audience tiers shown as rows in the wizard's step 1 (GROUP is reached via the
// existing AudienceSheet so group selection isn't duplicated).
const AUDIENCE_META = {
  PRIVATE: { label: "Only you", sub: "Private to your account" },
  FRIENDS: { label: "Friends", sub: "People you've added" },
  PUBLIC: { label: "Public", sub: "Anyone signed in" },
} as const;

// The sticky tray bar — the single thing shown once items are staged. The left
// (thumbnail + count) opens the items review; "Review & send →" opens the
// 2-step wizard. Replaces the old always-on "Process N" bar + inline settings.
function TrayBar({
  count,
  thumbUri,
  onReview,
  onSend,
  disabled,
}: {
  count: number;
  thumbUri?: string;
  onReview: () => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useTheme();
  return (
    <GlassSurface
      glass="clear"
      style={[
        styles.trayBar,
        { paddingBottom: BottomTabInset + insets.bottom + t.space.md },
      ]}
      glassStyle={styles.trayBarGlass}
      fallbackStyle={styles.trayBarFallback}
    >
      <Pressable
        onPress={onReview}
        accessibilityRole="button"
        accessibilityLabel={`${count} item${count === 1 ? "" : "s"} in tray. Tap to review.`}
        style={({ pressed }) => [
          styles.trayBarItem,
          pressed && (glassAvailable ? styles.glassPressed : styles.heroPressed),
        ]}
      >
        <View style={styles.trayThumb}>
          {thumbUri ? (
            <Image
              source={{ uri: thumbUri }}
              style={styles.trayThumbImg}
              contentFit="cover"
            />
          ) : (
            <Text style={styles.trayThumbCount}>{count}</Text>
          )}
        </View>
        <Text style={styles.trayBarLabel}>
          {count} item{count === 1 ? "" : "s"} in tray
        </Text>
      </Pressable>
      <Pressable
        onPress={onSend}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Review and send"
        style={({ pressed }) => [
          styles.trayBarSend,
          disabled && styles.trayBarSendOff,
          pressed && styles.heroPressed,
        ]}
      >
        <Text style={styles.trayBarSendText}>Review &amp; send →</Text>
      </Pressable>
    </GlassSurface>
  );
}

// The front-screen commit footer — shown only while the tray is empty
// (items.length === 0), mutually exclusive with the sticky TrayBar. Mirrors
// TrayBar's clear-glass shell but flows in the column (non-absolute) so it
// rides above the keyboard. Holds Paste (secondary, left) + the coral Add
// PrimaryButton (right). Every Paste/Add prop is copied verbatim from the old
// in-well omniActions block; the coral Add stays the single solid action.
function FrontAddBar({
  busy,
  omniText,
  onAdd,
  onPaste,
}: {
  busy: boolean;
  omniText: string;
  onAdd: () => void;
  onPaste: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const t = useTheme();
  return (
    <GlassSurface
      glass="clear"
      style={[
        styles.frontBar,
        { paddingBottom: BottomTabInset + insets.bottom + t.space.md },
      ]}
      glassStyle={styles.frontBarGlass}
      fallbackStyle={styles.frontBarFallback}
    >
      <Pressable
        onPress={onPaste}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Paste from clipboard"
        accessibilityHint="Adds your copied text or link to the input"
        style={({ pressed }) => [
          styles.pasteButton,
          pressed && styles.audiencePressed,
        ]}
      >
        <SymbolView
          name="doc.on.clipboard"
          size={14}
          weight="regular"
          tintColor={t.color.inkMuted}
          fallback={
            <Text style={styles.pasteGlyph} accessibilityElementsHidden>
              ⎘
            </Text>
          }
        />
        <Text style={styles.pasteLabel}>Paste</Text>
      </Pressable>
      <PrimaryButton
        label="Add"
        onPress={onAdd}
        disabled={busy || omniText.trim().length === 0}
        style={styles.omniAdd}
      />
    </GlassSurface>
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
    <GlassSurface
      glass="regular"
      style={styles.repoCard}
      glassStyle={styles.repoCardGlass}
      fallbackStyle={styles.repoCardFallback}
    >
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
    </GlassSurface>
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
      paddingBottom: t.space.xxl,
      gap: t.space.lg,
    },
    // Only the absolute TrayBar (items > 0) needs the bottom reservation; the
    // FrontAddBar flow footer reserves its own space in the column.
    containerTrayPad: { paddingBottom: 220 },
    header: { gap: t.space.lg, marginBottom: t.space.xs },

    // "Void" backdrop — soft luminous orbs faked from concentric low-alpha
    // circles (no blur/gradient libs available). Absolutely filled, clipped,
    // and behind the scrolling content.
    voidWrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      overflow: "hidden",
    },
    bloom: { position: "absolute", borderRadius: 999 },
    bloomSageOuter: {
      width: 460,
      height: 460,
      top: -70,
      left: "50%",
      marginLeft: -230,
      backgroundColor: "rgba(207,212,176,0.05)",
    },
    bloomSageMid: {
      width: 300,
      height: 300,
      top: 10,
      left: "50%",
      marginLeft: -150,
      backgroundColor: "rgba(207,212,176,0.07)",
    },
    bloomSageCore: {
      width: 170,
      height: 170,
      top: 70,
      left: "50%",
      marginLeft: -85,
      backgroundColor: "rgba(207,212,176,0.10)",
    },
    bloomSteelOuter: {
      width: 380,
      height: 380,
      top: 320,
      left: -120,
      backgroundColor: "rgba(125,153,196,0.05)",
    },
    bloomSteelCore: {
      width: 200,
      height: 200,
      top: 380,
      left: -40,
      backgroundColor: "rgba(125,153,196,0.08)",
    },

    // OmniInput — no box around the whole section; just stacked, plain.
    omni: {
      gap: t.space.md,
    },
    // The omni "well": on glass it's a padded, radiused liquid slab with a
    // hairline sage glow; off glass it's a bare wrapper (gap only) so the Field
    // keeps its own paper border and the section reads exactly as before.
    omniWell: {
      gap: t.space.md,
    },
    omniWellGlass: {
      padding: t.space.md,
      borderRadius: 28,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
    },
    omniWellFallback: {},
    omniInput: {
      minHeight: 96,
      textAlignVertical: "top",
      paddingTop: 12,
      backgroundColor: t.color.paper,
    },
    // Over glass the field drops its own paper fill + border so the material
    // shows through; the well supplies the frame.
    omniInputGlass: {
      backgroundColor: "transparent",
      borderWidth: 0,
    },
    omniActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: t.space.lg,
    },
    omniAdd: { paddingHorizontal: t.space.xl },
    pasteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xs,
      paddingVertical: t.space.xs,
    },
    pasteGlyph: { fontSize: 14, color: t.color.inkMuted },
    pasteLabel: {
      fontFamily: t.font.mono,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },

    // Attachment tiles (Photos, Audio) — the primary pair — + secondary chips.
    heroPressed: { backgroundColor: t.color.paperSunken },
    // On liquid glass, feedback is a gentle dim (a background swap would paint
    // over the material and kill the refraction).
    glassPressed: { opacity: 0.55 },
    mediaTiles: { flexDirection: "row", gap: t.space.md },
    // Surface = shell sizing (shared); Glass = radius + hairline sage glow;
    // Fallback = the opaque bordered paper card of today; Press = the inner
    // tappable content box (centering + padding) so the whole tile reacts.
    mediaTile: {
      flex: 1,
      minHeight: 104,
    },
    mediaTileGlass: {
      borderRadius: 24,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
    },
    mediaTileFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
    },
    mediaTilePress: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: t.space.xs,
      paddingVertical: t.space.lg,
      paddingHorizontal: t.space.sm,
    },
    mediaTileGlyph: {
      fontSize: 22,
      color: t.color.ink,
      fontFamily: t.font.serif,
    },
    mediaTileLabel: {
      fontFamily: t.font.serif,
      fontSize: 18,
      color: t.color.ink,
      marginTop: t.space.xs,
    },
    mediaTileSub: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
      textAlign: "center",
    },
    chipRow: { flexDirection: "row", gap: t.space.md },
    mediaChip: {
      flex: 1,
      minHeight: 46,
    },
    mediaChipGlass: {
      borderRadius: 999,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.steelSoft,
    },
    mediaChipFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    mediaChipPress: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: t.space.sm,
      paddingVertical: t.space.md,
    },
    mediaChipGlyph: {
      fontSize: 14,
      color: t.color.ink,
      fontFamily: t.font.serif,
    },
    mediaChipLabel: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    shareHint: {
      fontFamily: t.font.serif,
      fontSize: 13,
      fontStyle: "italic",
      color: t.color.inkMuted,
      lineHeight: 18,
    },

    // Pickers
    pickerEmptyText: {
      fontFamily: t.font.serif,
      fontSize: 15,
      fontStyle: "italic",
      color: t.color.inkMuted,
    },

    audiencePressed: { opacity: 0.6 },

    // Tray
    trayList: { gap: t.space.sm },
    trayEditRow: {
      gap: t.space.sm,
      padding: t.space.md,
    },
    // Glass = radiused accent-edged card; Fallback = today's opaque
    // accent-bordered paperRaised card.
    trayEditRowGlass: {
      borderRadius: 18,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.accent,
    },
    trayEditRowFallback: {
      borderWidth: 1,
      borderColor: t.color.accent,
      backgroundColor: t.color.paperRaised,
    },
    trayEditActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: t.space.md,
    },

    // Tray bar (sticky entry into the review flow). On glass it floats as an
    // inset clear-glass bar; off glass it's the full-width opaque paper bar with
    // a top rule (fallbackStyle) — today's look.
    trayBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
    },
    trayBarGlass: {
      left: t.space.md,
      right: t.space.md,
      borderRadius: 26,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
      paddingHorizontal: t.space.lg,
    },
    trayBarFallback: {
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderColor: t.color.ruleStrong,
    },

    // Front-screen commit footer (items === 0). Mirrors trayBar* but flows in
    // the column (non-absolute) so it rides above the keyboard: no position/
    // left/right/bottom, a horizontal float margin, and Paste↔Add spread apart.
    frontBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: t.space.md,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
      marginHorizontal: t.space.md,
    },
    frontBarGlass: {
      borderRadius: 26,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
      paddingHorizontal: t.space.lg,
    },
    frontBarFallback: {
      backgroundColor: t.color.paper,
      borderTopWidth: 1,
      borderColor: t.color.ruleStrong,
    },
    trayBarItem: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    trayThumb: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperSunken,
      alignItems: "center",
      justifyContent: "center",
    },
    trayThumbImg: { width: "100%", height: "100%" },
    trayThumbCount: {
      fontFamily: t.font.mono,
      fontSize: 16,
      color: t.color.ink,
    },
    trayBarLabel: {
      fontFamily: t.font.serif,
      fontSize: 16,
      color: t.color.ink,
      flexShrink: 1,
    },
    trayBarSend: {
      backgroundColor: t.color.accent,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.md,
    },
    trayBarSendOff: { opacity: 0.4 },
    trayBarSendText: {
      fontFamily: t.font.serif,
      fontSize: 16,
      color: t.color.paper,
    },
    submitButton: { width: "100%" },

    // Review & send wizard
    wizHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: t.space.xl,
      paddingBottom: t.space.md,
      borderBottomWidth: 1,
      borderBottomColor: t.color.rule,
    },
    wizBack: {
      width: 36,
      height: 36,
      marginLeft: -t.space.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    wizBackGlyph: {
      fontFamily: t.font.serif,
      fontSize: 30,
      lineHeight: 32,
      color: t.color.ink,
    },
    wizHelper: {
      fontFamily: t.font.serif,
      fontSize: 15,
      lineHeight: 20,
      color: t.color.inkMuted,
      marginTop: -t.space.sm,
    },
    wizStep: { flexDirection: "row", alignItems: "center", gap: t.space.sm },
    wizStepText: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    dots: { flexDirection: "row", gap: t.space.xs },
    dot: {
      width: 8,
      height: 8,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    dotOn: { backgroundColor: t.color.accent, borderColor: t.color.accent },
    wizBody: {
      gap: t.space.lg,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.xl,
      paddingBottom: t.space.xl,
    },
    wizFooter: {
      gap: t.space.sm,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.md,
      borderTopWidth: 1,
      borderColor: t.color.rule,
    },

    // Step 2 — [ FOCUS | NOTE ] segmented control + whole-submission note area
    segmented: {
      flexDirection: "row",
    },
    segmentedGlass: {
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
    },
    segmentedFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    segment: {
      flex: 1,
      alignItems: "center",
      paddingVertical: t.space.sm,
      backgroundColor: t.color.paper,
    },
    // Over glass the unselected segment drops its paper fill so the material
    // shows through; the selected segment (segmentOn) stays solid accent.
    segmentGlass: { backgroundColor: "transparent" },
    segmentOn: { backgroundColor: t.color.accent },
    segmentText: {
      fontFamily: t.font.mono,
      fontSize: 12,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    segmentTextOn: { color: t.color.onAccent },
    // The note area is wrapped in a glass well; the input itself is transparent
    // in both modes and the well owns the frame (glass glow, or opaque fallback).
    noteWell: {},
    noteWellGlass: {
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
    },
    noteWellFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
    },
    noteArea: {
      minHeight: 140,
      padding: t.space.md,
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 24,
      color: t.color.ink,
      textAlignVertical: "top",
    },

    // Step 2 — focus search + create. The row is a glass well; the inner
    // TextInput is already transparent so it reads through the material.
    focusSearch: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
    },
    focusSearchGlass: {
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.steelSoft,
    },
    focusSearchFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
    },
    focusSearchGlyph: { fontSize: 16, color: t.color.inkMuted },
    focusSearchInput: {
      flex: 1,
      fontFamily: t.font.serif,
      fontSize: 17,
      color: t.color.ink,
      padding: 0,
    },
    focusSearchClear: {
      fontFamily: t.font.mono,
      fontSize: 13,
      color: t.color.inkMuted,
    },
    focusAutoHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
    },
    focusRecTag: {
      fontFamily: t.font.mono,
      fontSize: 9,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.color.accent,
      borderWidth: 1,
      borderColor: t.color.accent,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    focusCreateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
      paddingVertical: t.space.lg,
      borderLeftWidth: 2,
      borderLeftColor: t.color.accent,
      paddingLeft: t.space.md,
    },
    focusCreatePlus: {
      fontFamily: t.font.serif,
      fontSize: 22,
      lineHeight: 24,
      color: t.color.accent,
    },
    focusCreateLabel: {
      fontFamily: t.font.serif,
      fontSize: 18,
      color: t.color.ink,
      flexShrink: 1,
    },
    // The audience option rows grouped as one card. Glass = radiused clear
    // slab; Fallback = opaque paperRaised card. Rows keep their own dividers.
    audCard: {},
    audCardGlass: {
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
      paddingHorizontal: t.space.md,
    },
    audCardFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      paddingHorizontal: t.space.md,
    },
    audRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: t.color.rule,
      paddingVertical: t.space.lg,
    },
    audText: { flex: 1, gap: 2 },
    audLabel: { fontFamily: t.font.serif, fontSize: 20, color: t.color.ink },
    audSub: { fontFamily: t.font.serif, fontSize: 14, color: t.color.inkMuted },
    radio: {
      width: 22,
      height: 22,
      borderWidth: 1,
      borderColor: t.color.rule,
    },
    radioOn: { backgroundColor: t.color.accent, borderColor: t.color.accent },

    // Sheets
    editInput: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
    keyboardDone: { alignSelf: "flex-end" },
    sheetCancel: { alignItems: "center" },
    sheetSecondaryButton: { marginTop: t.space.sm },
    // errorText is the legible-as-text error variant (clears WCAG-AA in both
    // themes); the raw `error` fill hue is too low-contrast as body text on dark.
    repoError: { color: t.color.errorText, fontFamily: t.font.mono, fontSize: 12 },
    repoCard: {
      padding: t.space.md,
      gap: t.space.sm,
    },
    repoCardGlass: {
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: t.color.markSoft,
    },
    repoCardFallback: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
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
    repoMeta: {
      fontFamily: t.font.mono,
      fontSize: 12,
      color: t.color.inkMuted,
    },
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
