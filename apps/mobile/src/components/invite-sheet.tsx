import { useState } from "react";
import { Share, View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { authBaseURL } from "@/lib/auth-client";
import { useTheme } from "@/constants/theme-context";
import { Sheet, PrimaryButton, SecondaryButton, Eyebrow } from "@/components/sirius";

export function InviteSheet({
  handle,
  visible,
  onClose,
}: {
  handle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = `${authBaseURL}/u/${handle}`;
  const cardUri = `${authBaseURL}/u/${handle}/card`;
  const qrUri = `${authBaseURL}/u/${handle}/qr`;

  async function copyLink() {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function shareLink() {
    await Share.share({ message: "Add me on Sirius", url: link });
  }

  async function shareCardImage() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        await shareLink();
        return;
      }
      const file = await File.downloadFileAsync(cardUri, Paths.cache);
      try {
        await Sharing.shareAsync(file.uri, {
          mimeType: "image/png",
          UTI: "public.png",
          dialogTitle: "Share your Sirius invite",
        });
      } finally {
        try { file.delete(); } catch {}
      }
    } catch {
      await shareLink();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="Invite a friend" onClose={onClose}>
      <View style={styles.gap}>
        <Image
          source={{ uri: cardUri }}
          style={styles.card}
          contentFit="contain"
          accessibilityLabel="Your invite card"
        />
        <View style={[styles.qrTile, { backgroundColor: "#ffffff" }]}>
          <Image source={{ uri: qrUri }} style={styles.qr} contentFit="contain" accessibilityLabel="QR code to add me" />
        </View>
        <Eyebrow style={{ textAlign: "center", color: t.color.inkSubtle }}>
          Scan to add me
        </Eyebrow>

        <PrimaryButton label="Share link" onPress={shareLink} />
        <SecondaryButton
          label="Share card image"
          symbol="photo"
          busy={busy}
          onPress={shareCardImage}
        />
        <SecondaryButton
          label={copied ? "Copied ✓" : "Copy link"}
          symbol="link"
          onPress={copyLink}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 16 },
  card: { width: "100%", aspectRatio: 1200 / 630, borderRadius: 10 },
  qrTile: { alignSelf: "center", borderRadius: 12, padding: 12 },
  qr: { width: 160, height: 160 },
});
