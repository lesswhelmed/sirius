// Bottom sheet to set a post's read visibility (PRIVATE | FRIENDS | PUBLIC).
// The current value is fetched from the server when the sheet opens (setting
// visibility is inherently an online action), and saved with a PUT. Mirrors the
// Stitch "Ledger Editorial" visibility sheet.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";

import { PrimaryButton, Sheet } from "@/components/sirius";
import { Segment, SegmentedControl } from "@/components/segmented";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { ApiError, apiGet, apiSend } from "@/lib/api";

export type Visibility = "PRIVATE" | "FRIENDS" | "PUBLIC";

const HINT: Record<Visibility, string> = {
  PRIVATE: "Only you",
  FRIENDS: "People you've added",
  PUBLIC: "Anyone signed in",
};

export function VisibilitySheet({
  slug,
  visible,
  onClose,
}: {
  slug: string;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // Fetch the post's current visibility only while the sheet is open.
  const { data, isLoading } = useQuery({
    queryKey: ["post-visibility", slug],
    queryFn: () => apiGet<{ visibility: Visibility }>(`/api/app/posts/${slug}`),
    enabled: visible,
  });
  // The user's pending choice overrides the fetched value until saved/closed.
  const [selected, setSelected] = useState<Visibility | null>(null);
  const [saving, setSaving] = useState(false);
  const value = selected ?? data?.visibility ?? null;

  // Reset the pending choice every time the sheet closes (no effect needed).
  const close = () => {
    setSelected(null);
    onClose();
  };

  async function save() {
    if (!value || saving) return;
    setSaving(true);
    try {
      await apiSend(`/api/app/posts/${slug}/visibility`, "PUT", {
        visibility: value,
      });
      close();
    } catch (err) {
      Alert.alert(
        "Couldn’t save",
        err instanceof ApiError ? err.message : "Try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} title="Visibility" onClose={close}>
      {isLoading || !value ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.color.accent} />
        </View>
      ) : (
        <>
          <SegmentedControl value={value} onChange={(v) => setSelected(v as Visibility)}>
            <Segment value="PRIVATE" label="Private" />
            <Segment value="FRIENDS" label="Friends" />
            <Segment value="PUBLIC" label="Public" />
          </SegmentedControl>
          <Text style={styles.hint}>{HINT[value]}</Text>
          <PrimaryButton label="Save" busy={saving} onPress={save} />
        </>
      )}
    </Sheet>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    loading: { paddingVertical: t.space.xl, alignItems: "center" },
    hint: {
      fontFamily: t.font.serif,
      fontStyle: "italic",
      fontSize: 14,
      color: t.color.inkSubtle,
      marginTop: t.space.sm,
      marginBottom: t.space.md,
    },
  });
}
