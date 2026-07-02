// The saved conversation threads — opened from the header "Chats" button. Tap a
// row to switch threads, Delete to remove one (and all its messages). Backed by
// a live query so the list stays in sync as titles/timestamps change.
import { desc } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Screen } from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useThemedStyles } from "@/constants/theme-context";
import { db } from "@/lib/db/client";
import { chatConversations } from "@/lib/db/schema";

export function ChatsModal({
  visible,
  activeId,
  onSelect,
  onDelete,
  onClose,
}: {
  visible: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { data: convos } = useLiveQuery(
    db
      .select()
      .from(chatConversations)
      .orderBy(desc(chatConversations.updatedAt)),
  );
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <Screen style={styles.container}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Chats</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
            <Text style={styles.headerAction}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.cardStack}>
          {(convos ?? []).length === 0 ? (
            <Text style={styles.emptyText}>No conversations yet.</Text>
          ) : (
            (convos ?? []).map((c) => (
              <View
                key={c.id}
                style={[
                  styles.chatRow,
                  c.id === activeId ? styles.chatRowActive : null,
                ]}
              >
                <Pressable
                  style={styles.flex}
                  onPress={() => onSelect(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${c.title ?? "New chat"}`}
                >
                  <Text style={styles.chatRowTitle} numberOfLines={1}>
                    {c.title ?? "New chat"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(c.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${c.title ?? "chat"}`}
                >
                  <Text style={styles.deleteAction}>Delete</Text>
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, padding: 16 },
    cardStack: { gap: 16, paddingBottom: 16 },
    modalHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: 12,
    },
    modalTitle: {
      color: t.color.ink,
      fontFamily: t.font.serif,
      fontSize: 22,
    },
    headerAction: { color: t.color.ink, fontSize: 16, fontWeight: "600" },
    emptyText: { color: t.color.inkMuted, fontSize: 14, lineHeight: 20 },
    chatRow: {
      alignItems: "center",
      backgroundColor: t.color.paperRaised,
      borderRadius: 10,
      flexDirection: "row",
      gap: 12,
      padding: 14,
    },
    chatRowActive: { borderColor: t.color.ink, borderWidth: 1 },
    chatRowTitle: { color: t.color.ink, fontSize: 15, fontWeight: "600" },
    deleteAction: { color: t.color.danger, fontSize: 13, fontWeight: "600" },
  });
}
