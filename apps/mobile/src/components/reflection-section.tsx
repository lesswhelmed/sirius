// Reflection thread for the post detail screen: AI-generated prompts inviting
// the OWNER to write their own take on the material, plus the owner's answers.
//
// Mirror-first read (same discipline as comments-section.tsx): the thread is a
// live query over the local `reflection_prompts` / `reflection_responses`
// mirror — renders instantly offline, updates as the sync engine reconciles
// server deltas. WRITES are online-only v1 (no outbox): the composer POSTs /
// PATCHes / DELETEs directly, optimistically folds the accepted write into the
// mirror (reflection-writes.ts), and the delta pull converges.
//
// Renders NOTHING when the post has no visible prompt rows (backwards compat —
// pre-reflection posts show no new chrome). Owner sees composers on unanswered
// active prompts; peers see the answered Q&A read-only.
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import { useNetworkState } from "expo-network";
import { asc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Eyebrow,
  Field,
  KeyboardDoneButton,
  PrimaryButton,
  SecondaryButton,
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiDelete, apiPatch, apiPostJson, ApiError, uploadFile } from "@/lib/api";
import { authBaseURL, authClient } from "@/lib/auth-client";
import { db } from "@/lib/db/client";
import {
  type ReflectionPromptRow,
  type ReflectionResponseRow,
  reflectionPrompts,
  reflectionResponses,
} from "@/lib/db/schema";
import { canTranscribeOnDevice, transcribeAudio } from "@/lib/llm/transcribe";
import { kickSync } from "@/lib/sync/engine";
import {
  applyLocalReflectionResponse,
  removeLocalReflectionResponse,
} from "@/lib/sync/reflection-writes";

// Subset of the routes' wire shapes we actually consume (POST returns the full
// thread item, PATCH returns the bare response — see
// apps/web/lib/reflections/wire.ts).
type ResponseWire = {
  id: string;
  body: string;
  hasAudio: boolean;
  audioUrl: string | null;
};
type PostResult = { item: { id: string; response: ResponseWire | null } | null };
type PatchResult = { response: ResponseWire | null };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 422) return "This answer was flagged and can't be saved.";
    if (err.status === 413) return "That recording is too large to upload.";
    return `Couldn't save (${err.status}). Try again.`;
  }
  return "Network error — check your connection and try again.";
}

// ── Inline audio player for a voice answer ──────────────────────────────────
// Same pattern as original-content-section.tsx's AudioPlayer: the source
// carries the session cookie explicitly (a native player shares no cookie jar
// with the better-auth client) and streams from the canReadPost-gated route.
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function ReflectionAudioPlayer({
  postSlug,
  promptServerId,
}: {
  postSlug: string;
  promptServerId: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const source = useMemo(() => {
    const cookie = authClient.getCookie();
    return {
      uri: `${authBaseURL}/api/app/posts/${postSlug}/reflections/audio/${promptServerId}`,
      headers: cookie ? { Cookie: cookie } : undefined,
    };
  }, [postSlug, promptServerId]);
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const trackWidthRef = useRef(0);

  const duration = status.duration || 0;
  const progress = duration > 0 ? status.currentTime / duration : 0;

  const seekToSeconds = (seconds: number) => {
    if (duration <= 0) return;
    void player.seekTo(Math.min(duration, Math.max(0, seconds)));
  };
  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };
  const onSeek = (e: { nativeEvent: { locationX: number } }) => {
    const width = trackWidthRef.current;
    if (width <= 0 || duration <= 0) return;
    const fraction = Math.min(1, Math.max(0, e.nativeEvent.locationX / width));
    seekToSeconds(fraction * duration);
  };
  const SEEK_STEP_SECONDS = 10;

  return (
    <View style={styles.audioRow}>
      <Pressable
        onPress={() => (status.playing ? player.pause() : player.play())}
        accessibilityRole="button"
        accessibilityLabel={
          status.playing ? "Pause voice answer" : "Play voice answer"
        }
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
      >
        {status.isLoaded ? (
          <Text style={styles.playGlyph}>{status.playing ? "❚❚" : "▶"}</Text>
        ) : (
          <ActivityIndicator color={t.color.accent} size="small" />
        )}
      </Pressable>
      <View style={styles.audioMain}>
        <Pressable
          onPress={onSeek}
          onLayout={onTrackLayout}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek voice answer"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(progress * 100),
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "increment") {
              seekToSeconds(status.currentTime + SEEK_STEP_SECONDS);
            } else if (e.nativeEvent.actionName === "decrement") {
              seekToSeconds(status.currentTime - SEEK_STEP_SECONDS);
            }
          }}
          style={styles.track}
        >
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </Pressable>
        <Text style={styles.audioTime}>
          {formatTime(status.currentTime)} / {formatTime(duration)}
        </Text>
      </View>
    </View>
  );
}

// ── Owner composer (answer / edit) ──────────────────────────────────────────
// New answers may attach a voice recording: record via expo-audio (same
// recorder pattern as composer.tsx), transcribe on-device (iOS 26+ Apple
// SpeechAnalyzer — `canMic` is false everywhere else, so non-iOS is text-only)
// into the EDITABLE field, then submit multipart (audio + transcript body).
// Edits are text-only (PATCH never detaches an existing recording).
function ReflectionComposer({
  postSlug,
  prompt,
  existing,
  online,
  canMic,
  onDone,
}: {
  postSlug: string;
  prompt: ReflectionPromptRow;
  // Present in edit mode; its serverId addresses the PATCH.
  existing: ReflectionResponseRow | null;
  online: boolean;
  canMic: boolean;
  onDone?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const isEdit = existing != null;
  const canSave = body.trim().length > 0 && online && !busy && !recording;

  const startRecording = async () => {
    setError(null);
    const status = await AudioModule.requestRecordingPermissionsAsync();
    if (!status.granted) {
      setError("Allow microphone access in Settings to record an answer.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await audioRecorder.prepareToRecordAsync();
    audioRecorder.record();
    setRecording(true);
  };

  const stopRecording = async () => {
    await audioRecorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    setRecording(false);
    const uri = audioRecorder.uri;
    if (!uri) return;
    setAudioUri(uri);
    // Transcribe on-device into the editable field; the user can rewrite the
    // text before saving. A failed transcription keeps the recording — the
    // typed body still satisfies the required transcript.
    setTranscribing(true);
    try {
      const text = await transcribeAudio(uri);
      if (text) {
        setBody((prev) => (prev.trim().length > 0 ? `${prev}\n${text}` : text));
      } else {
        setError("Couldn't transcribe — type your answer to save.");
      }
    } finally {
      setTranscribing(false);
    }
  };

  const onSave = async () => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit) {
        const res = await apiPatch<PatchResult>(
          `/api/app/reflection-responses/${existing.serverId}`,
          { body: trimmed },
        );
        await applyLocalReflectionResponse({
          promptServerId: prompt.serverId,
          postSlug,
          body: res?.response?.body ?? trimmed,
          hasAudio: res?.response?.hasAudio ?? existing.hasAudio,
          serverId: res?.response?.id ?? existing.serverId,
        });
      } else {
        const path = `/api/app/posts/${postSlug}/reflections`;
        let result: PostResult | null;
        if (audioUri) {
          result = await uploadFile<PostResult>(path, audioUri, {
            fieldName: "audio",
            mimeType: "audio/x-m4a",
            parameters: { promptId: prompt.serverId, body: trimmed },
          });
        } else {
          result = await apiPostJson<PostResult>(path, {
            promptId: prompt.serverId,
            body: trimmed,
          });
        }
        const wire = result?.item?.response ?? null;
        await applyLocalReflectionResponse({
          promptServerId: prompt.serverId,
          postSlug,
          body: wire?.body ?? trimmed,
          hasAudio: wire?.hasAudio ?? audioUri != null,
          serverId: wire?.id ?? null,
        });
      }
      setBody("");
      setAudioUri(null);
      // Nudge the sync loop so the canonical row converges promptly.
      kickSync("reflection-saved");
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.composer}>
      <Field
        label={isEdit ? "Edit your reflection" : "Your reflection"}
        placeholder="Write your own take…"
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={20000}
        editable={!busy && !transcribing}
      />
      <KeyboardDoneButton />
      {audioUri && !isEdit ? (
        <View style={styles.audioChipRow}>
          <Text style={styles.audioChip}>Voice recording attached</Text>
          <Pressable
            onPress={() => setAudioUri(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Remove voice recording"
            disabled={busy}
          >
            <Text style={styles.audioChipRemove}>Remove</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composerActions}>
        {canMic && !isEdit ? (
          <SecondaryButton
            label={recording ? "Stop" : "Record"}
            symbol={recording ? "stop.fill" : "mic.fill"}
            busy={transcribing}
            disabled={busy}
            accessibilityLabel={
              recording ? "Stop recording" : "Record a voice answer"
            }
            accessibilityHint={
              recording
                ? "Stops recording and transcribes it into the answer field"
                : "Records audio and transcribes it on this device"
            }
            onPress={() => void (recording ? stopRecording() : startRecording())}
            style={styles.micButton}
          />
        ) : null}
        <PrimaryButton
          label={isEdit ? "Save changes" : "Save reflection"}
          busy={busy}
          disabled={!canSave}
          onPress={() => void onSave()}
          style={styles.saveButton}
        />
      </View>
      {!online ? (
        <Text style={styles.offlineHint}>
          Connect to the internet to answer.
        </Text>
      ) : null}
      {isEdit && onDone ? (
        <Pressable
          onPress={onDone}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Cancel editing"
          disabled={busy}
        >
          <Text style={styles.cancelLink}>Cancel</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {busy ? (
        <ActivityIndicator color={t.color.accent} style={styles.spinner} />
      ) : null}
    </View>
  );
}

// ── One prompt (question + answer state) ────────────────────────────────────
function PromptItem({
  postSlug,
  prompt,
  response,
  isOwner,
  online,
  canMic,
}: {
  postSlug: string;
  prompt: ReflectionPromptRow;
  response: ReflectionResponseRow | null;
  isOwner: boolean;
  online: boolean;
  canMic: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const superseded = prompt.status === "superseded";
  // A just-written optimistic row carries a placeholder id until the delta
  // pull swaps in the canonical one; PATCH/DELETE address the server id, so
  // hold those affordances until it lands (mirrors comments' serverId gate).
  const linked = response != null && !response.serverId.startsWith("local:");
  const canMutate = isOwner && !superseded && linked && online;

  const onDelete = async () => {
    if (!response || !linked) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/app/reflection-responses/${response.serverId}`);
      await removeLocalReflectionResponse(prompt.serverId);
      kickSync("reflection-deleted");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <View style={styles.prompt}>
      {superseded ? (
        <Text style={styles.supersededTag}>Earlier reflection</Text>
      ) : null}
      <Text style={styles.question}>{prompt.question}</Text>
      {prompt.rationale ? (
        <Text style={styles.rationale}>{prompt.rationale}</Text>
      ) : null}

      {response && !editing ? (
        <View style={styles.answer}>
          {response.body ? (
            <Text style={styles.answerBody}>{response.body}</Text>
          ) : null}
          {response.hasAudio ? (
            <ReflectionAudioPlayer
              postSlug={postSlug}
              promptServerId={prompt.serverId}
            />
          ) : null}
          {canMutate ? (
            <View style={styles.answerActions}>
              <Pressable
                onPress={() => setEditing(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Edit reflection"
                disabled={deleteBusy}
              >
                <Text style={styles.actionLink}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={() => void onDelete()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete reflection"
                accessibilityState={{ busy: deleteBusy }}
                disabled={deleteBusy}
              >
                <Text style={styles.actionLink}>
                  {deleteBusy ? "Deleting…" : "Delete"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {isOwner && !superseded && (!response || editing) ? (
        <ReflectionComposer
          postSlug={postSlug}
          prompt={prompt}
          existing={editing ? response : null}
          online={online}
          canMic={canMic}
          onDone={editing ? () => setEditing(false) : undefined}
        />
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// ── The section ─────────────────────────────────────────────────────────────
export function ReflectionSection({
  postSlug,
  isOwner,
}: {
  postSlug: string;
  isOwner: boolean;
}) {
  const styles = useThemedStyles(makeStyles);

  const { data: promptRows } = useLiveQuery(
    db
      .select()
      .from(reflectionPrompts)
      .where(eq(reflectionPrompts.postSlug, postSlug))
      .orderBy(asc(reflectionPrompts.createdAt), asc(reflectionPrompts.order)),
    [postSlug],
  );
  const { data: responseRows } = useLiveQuery(
    db
      .select()
      .from(reflectionResponses)
      .where(eq(reflectionResponses.postSlug, postSlug)),
    [postSlug],
  );

  // Treat "no signal yet" as online — only an authoritative false disables the
  // composer, so a slow reachability probe never blocks a connected user.
  const networkState = useNetworkState();
  const online = networkState.isInternetReachable !== false;

  // On-device transcription availability (iOS 26+ SpeechAnalyzer; the non-iOS
  // module is a permanent no-op). Async probe → default text-only.
  const [canMic, setCanMic] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void canTranscribeOnDevice().then((ok) => {
      if (!cancelled) setCanMic(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const responseByPrompt = new Map<string, ReflectionResponseRow>(
    (responseRows ?? []).map((row) => [row.promptServerId, row]),
  );

  // Server ordering discipline (listReflectionForPost): active prompts in
  // batch order, then superseded prompts that still carry an answer
  // (read-only history). Tombstones are filtered in SQL-adjacent JS here (the
  // status column is indexed but the row count per post is tiny).
  const live = (promptRows ?? []).filter((row) => row.status !== "tombstone");
  const active = live.filter((row) => row.status === "active");
  const supersededAnswered = live.filter(
    (row) =>
      row.status === "superseded" && responseByPrompt.has(row.serverId),
  );
  // Peers only ever see answered Q&A; the owner also sees unanswered active
  // prompts (their composers).
  const visible = [
    ...(isOwner
      ? active
      : active.filter((row) => responseByPrompt.has(row.serverId))),
    ...supersededAnswered,
  ];

  // Backwards compat: no prompt rows (or nothing a peer may see) → no chrome.
  if (visible.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Eyebrow accessibilityRole="header">Reflections</Eyebrow>
      <Text style={styles.subtitle}>
        {isOwner
          ? "Questions from your library — answer in your own words."
          : "The author's own take, in their words."}
      </Text>
      <View style={styles.list}>
        {visible.map((prompt) => (
          <PromptItem
            key={prompt.serverId}
            postSlug={postSlug}
            prompt={prompt}
            response={responseByPrompt.get(prompt.serverId) ?? null}
            isOwner={isOwner}
            online={online}
            canMic={canMic}
          />
        ))}
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    section: {
      marginTop: t.space.xl,
      paddingTop: t.space.lg,
      borderTopWidth: 1,
      borderTopColor: t.color.rule,
      gap: t.space.sm,
    },
    subtitle: {
      fontFamily: t.font.serif,
      fontSize: 14,
      fontStyle: "italic",
      color: t.color.inkMuted,
    },
    list: { gap: t.space.xl, marginTop: t.space.sm },
    prompt: {
      gap: t.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.color.rule,
      paddingBottom: t.space.lg,
    },
    supersededTag: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    question: {
      fontFamily: t.font.serif,
      fontSize: 17,
      lineHeight: 25,
      color: t.color.ink,
    },
    rationale: {
      fontFamily: t.font.serif,
      fontSize: 13,
      lineHeight: 19,
      fontStyle: "italic",
      color: t.color.inkSubtle,
    },
    answer: {
      gap: t.space.sm,
      borderLeftWidth: 2,
      borderLeftColor: t.color.accent,
      paddingLeft: t.space.md,
    },
    answerBody: {
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 24,
      color: t.color.ink,
    },
    answerActions: {
      flexDirection: "row",
      gap: t.space.lg,
    },
    actionLink: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    composer: { gap: t.space.md, marginTop: t.space.xs },
    composerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    micButton: { flexShrink: 0 },
    saveButton: { flex: 1 },
    audioChipRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    audioChip: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    audioChipRemove: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    offlineHint: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    cancelLink: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    error: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.danger,
    },
    spinner: { alignSelf: "flex-start" },
    // Audio player (mirrors original-content-section.tsx)
    audioRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.md,
    },
    playButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: t.color.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.6 },
    playGlyph: {
      color: t.color.accent,
      fontSize: 14,
    },
    audioMain: { flex: 1, gap: t.space.xs },
    track: {
      height: 6,
      borderRadius: 3,
      backgroundColor: t.color.paperSunken,
      overflow: "hidden",
    },
    trackFill: {
      height: "100%",
      backgroundColor: t.color.accent,
    },
    audioTime: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
  });
}
