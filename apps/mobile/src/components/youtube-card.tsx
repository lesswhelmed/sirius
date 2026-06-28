// Native YouTube embed for post bodies. The worker prepends a `<YouTubeEmbed>`
// tag the markdown renderer can't show; PostBody turns it into this flat
// editorial card — a thumbnail with a play badge that opens the video in the
// YouTube app (browser fallback). No WebView, matching the app's native render.

import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { openBrowserAsync } from "expo-web-browser";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";

async function openVideo(url: string, videoId: string): Promise<void> {
  const appUrl = `vnd.youtube://${videoId}`;
  try {
    if (await Linking.canOpenURL(appUrl)) {
      await Linking.openURL(appUrl);
      return;
    }
  } catch {
    // No YouTube app / unsupported scheme — fall back to the browser.
  }
  try {
    await openBrowserAsync(url);
  } catch {
    // A malformed URL shouldn't crash the post view; ignore.
  }
}

export function YouTubeCard({ url, videoId }: { url: string; videoId: string }) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={() => {
        void openVideo(url, videoId);
      }}
      accessibilityRole="button"
      accessibilityLabel="Play YouTube video"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <Image
        source={{ uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
        style={styles.thumb}
        contentFit="cover"
        transition={150}
        accessible={false}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.playBadge}>
          <SymbolView
            name="play.fill"
            size={28}
            tintColor={t.color.onAccent}
            fallback={<Text style={styles.playGlyph}>▶</Text>}
          />
        </View>
      </View>
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      marginBottom: t.space.lg,
      borderWidth: t.rule.hairline,
      borderColor: t.color.rule,
      backgroundColor: t.color.paperRaised,
      borderRadius: t.radius.none,
      overflow: "hidden",
    },
    cardPressed: { opacity: 0.85 },
    // hqdefault is 4:3 with letterbox bars; cover-cropping to 16:9 hides them.
    thumb: { width: "100%", aspectRatio: 16 / 9 },
    overlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    playBadge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.color.scrim,
      alignItems: "center",
      justifyContent: "center",
    },
    playGlyph: { color: t.color.onAccent, fontSize: 26 },
  });
}
