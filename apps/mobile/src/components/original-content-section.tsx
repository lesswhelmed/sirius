// Owner-only "Original capture" section on the post detail screen: the raw note
// the user typed at ingest, plus an inline player per retained audio original.
// The data is owner-gated and lives only on the server (never in the offline
// mirror), so this fetches it live and renders nothing unless the viewer owns the
// post (the caller gates on a mirror-backed row) and there's content to show.
import { useQuery } from "@tanstack/react-query";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useMemo, useRef } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Eyebrow } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiGet } from "@/lib/api";
import { authBaseURL, authClient } from "@/lib/auth-client";

// Mirrors the buildOriginalContent shape returned by GET /api/app/posts/[slug]/original.
type OriginalNote = {
  submissionId: string;
  kind: string;
  text: string;
  urls: string[];
};
type OriginalAudio = {
  submissionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  // Server-relative inline-streaming URL (owner-gated, Range-enabled).
  src: string;
};
type OriginalContent = { notes: OriginalNote[]; audio: OriginalAudio[] };

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// One inline audio player. Each retained audio gets its own component so each can
// own a useAudioPlayer hook (hooks can't run in a loop). The source carries the
// session cookie so the owner-gated source route streams the private file.
function AudioPlayer({ audio }: { audio: OriginalAudio }) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // Stable source object so the player isn't recreated on every render. The
  // cookie is attached as an HTTP header — a native player has no shared cookie
  // jar with the better-auth client, so we pass it explicitly (same move as
  // uploadFile in lib/api.ts).
  const source = useMemo(() => {
    const cookie = authClient.getCookie();
    return {
      uri: `${authBaseURL}${audio.src}`,
      headers: cookie ? { Cookie: cookie } : undefined,
    };
  }, [audio.src]);

  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  // Track width is only consulted inside the seek handler to map a tap's x to a
  // fraction — it's never rendered — so a ref avoids a re-render on every layout.
  const trackWidthRef = useRef(0);

  const duration = status.duration || 0;
  const progress = duration > 0 ? status.currentTime / duration : 0;
  const meta = [audio.filename, formatBytes(audio.sizeBytes)]
    .filter(Boolean)
    .join(" · ");

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };
  // Single seek primitive (clamped to [0, duration]) shared by the tap/drag path
  // and the VoiceOver increment/decrement actions below, so they can never drift.
  const seekToSeconds = (seconds: number) => {
    if (duration <= 0) return;
    const clamped = Math.min(duration, Math.max(0, seconds));
    void player.seekTo(clamped);
  };
  const onSeek = (e: { nativeEvent: { locationX: number } }) => {
    const trackWidth = trackWidthRef.current;
    if (trackWidth <= 0 || duration <= 0) return;
    const fraction = Math.min(
      1,
      Math.max(0, e.nativeEvent.locationX / trackWidth),
    );
    seekToSeconds(fraction * duration);
  };
  const SEEK_STEP_SECONDS = 10;
  const onSeekAccessibilityAction = (e: {
    nativeEvent: { actionName: string };
  }) => {
    if (e.nativeEvent.actionName === "increment") {
      seekToSeconds(status.currentTime + SEEK_STEP_SECONDS);
    } else if (e.nativeEvent.actionName === "decrement") {
      seekToSeconds(status.currentTime - SEEK_STEP_SECONDS);
    }
  };

  return (
    <View style={styles.audioCard}>
      <View style={styles.audioRow}>
        <Pressable
          onPress={() => (status.playing ? player.pause() : player.play())}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pause audio" : "Play audio"}
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
            accessibilityLabel="Seek audio"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            accessibilityActions={[
              { name: "increment" },
              { name: "decrement" },
            ]}
            onAccessibilityAction={onSeekAccessibilityAction}
            style={styles.track}
          >
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          </Pressable>
          <Text style={styles.audioTime}>
            {formatTime(status.currentTime)} / {formatTime(duration)}
          </Text>
        </View>
      </View>
      {meta ? <Text style={styles.audioMeta}>{meta}</Text> : null}
    </View>
  );
}

export function OriginalContentSection({
  slug,
  enabled,
}: {
  slug: string;
  // True only when the viewer owns the post (the caller passes a mirror-backed
  // row check). Originals are owner-only, so we never even fetch otherwise.
  enabled: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { data } = useQuery({
    queryKey: ["post-original", slug],
    queryFn: () => apiGet<OriginalContent>(`/api/app/posts/${slug}/original`),
    enabled: enabled && !!slug,
    // Originals don't change after ingest; no need to refetch aggressively.
    staleTime: 5 * 60 * 1000,
  });

  if (!data || (data.notes.length === 0 && data.audio.length === 0)) {
    return null;
  }

  return (
    <View style={styles.section}>
      <Eyebrow>Original capture</Eyebrow>
      <Text style={styles.subtitle}>As ingested · visible only to you</Text>

      {data.audio.map((audio) => (
        <AudioPlayer key={audio.submissionId} audio={audio} />
      ))}

      {data.notes.map((note) => (
        <View key={note.submissionId} style={styles.noteBlock}>
          {note.urls.map((url) => (
            <Text
              key={url}
              style={styles.noteUrl}
              onPress={() => void Linking.openURL(url)}
              accessibilityRole="link"
            >
              {url}
            </Text>
          ))}
          {note.text ? <Text style={styles.noteText}>{note.text}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    section: {
      marginTop: t.space.lg,
      paddingTop: t.space.md,
      borderTopWidth: 1,
      borderTopColor: t.color.ruleEmphatic,
      gap: t.space.sm,
    },
    subtitle: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkFaint,
      marginTop: -t.space.xs,
    },
    audioCard: {
      borderWidth: 1,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      padding: t.space.md,
      gap: t.space.sm,
    },
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
    audioMeta: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkMuted,
    },
    noteBlock: {
      borderLeftWidth: 1,
      borderLeftColor: t.color.ruleEmphatic,
      paddingLeft: t.space.md,
      gap: t.space.xs,
    },
    noteUrl: {
      fontFamily: t.font.mono,
      fontSize: 13,
      color: t.color.accent,
      textDecorationLine: "underline",
    },
    noteText: {
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 26,
      color: t.color.ink,
    },
  });
}
