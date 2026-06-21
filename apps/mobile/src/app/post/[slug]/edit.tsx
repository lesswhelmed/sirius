// Owner post-body editor. Reached via the "Content · Edit ▸" row on the detail
// screen. Local-mirror-first like the detail view: it reads from the on-device
// row (instant, offline) and writes back through the SAME PATCH route the web
// editor uses. The mirror reconciliation is LWW-safe — we optimistically update
// the local body but only ever commit serverUpdatedAt from the PATCH response's
// authoritative timestamp (see commitLocalPostEdit), never a client guess.
import type { Category, Post, Tag } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { and, eq, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardDoneButton, PrimaryButton, Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet, apiPatch } from "@/lib/api";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import { kickSync } from "@/lib/sync/engine";
import { applyLocalPostEdit, commitLocalPostEdit } from "@/lib/sync/writes";

type PostDetail = Post & { tags: Tag[]; categories: Category[] };
type PatchResult = { updatedAt?: string; status?: string };

export default function EditPostScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();

  // Local-mirror row (owned posts only ever live here).
  const { data: localRows } = useLiveQuery(
    db
      .select()
      .from(posts)
      .where(and(eq(posts.slug, slug), ne(posts.syncState, "tombstone")))
      .limit(1),
  );
  const localLoaded = localRows !== undefined;
  const localRow = localRows?.[0] ?? null;

  // Server fetch: a fallback source for a deep-linked post not in the mirror,
  // AND the only place the post's status (DRAFT vs PUBLISHED) is known — the
  // mirror doesn't store status, so the "Publish" affordance is gated on this.
  const { data: serverPost } = useQuery({
    queryKey: ["post-edit", slug],
    queryFn: () => apiGet<PostDetail>(`/api/app/posts/${slug}`),
    enabled: !!slug && localLoaded,
  });

  // Pending edits overlay the source of truth (null = untouched) — the repo's
  // seed-free form pattern (see VisibilitySheet), which avoids setState-in-effect.
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [excerptEdit, setExcerptEdit] = useState<string | null>(null);
  const [bodyEdit, setBodyEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const base = useMemo(
    () =>
      localRow
        ? {
            title: localRow.title,
            excerpt: localRow.excerpt ?? "",
            body: localRow.body,
          }
        : serverPost
          ? {
              title: serverPost.title,
              excerpt: serverPost.excerpt ?? "",
              body: serverPost.content,
            }
          : null,
    [localRow, serverPost],
  );

  const title = titleEdit ?? base?.title ?? "";
  const excerpt = excerptEdit ?? base?.excerpt ?? "";
  const body = bodyEdit ?? base?.body ?? "";

  const isDraft = serverPost?.status === "DRAFT";
  const dirty =
    base != null &&
    ((titleEdit != null && titleEdit !== base.title) ||
      (excerptEdit != null && excerptEdit !== base.excerpt) ||
      (bodyEdit != null && bodyEdit !== base.body));

  const save = useCallback(
    async (publish: boolean) => {
      if (!base) return;
      const prev = base; // pre-optimistic snapshot for rollback
      setSaving(true);
      const fields = {
        title: title.trim(),
        excerpt: excerpt.trim() === "" ? null : excerpt.trim(),
        body,
      };
      // Optimistic local write so the detail view updates instantly. Does NOT
      // touch serverUpdatedAt (that comes from the response).
      if (localRow) {
        await applyLocalPostEdit(localRow.localId, fields);
      }
      try {
        const payload: {
          title: string;
          excerpt: string | null;
          content: string;
          status?: string;
        } = {
          title: fields.title,
          excerpt: fields.excerpt,
          content: fields.body,
        };
        if (publish) payload.status = "PUBLISHED";
        const res = await apiPatch<PatchResult>(
          `/api/app/posts/${slug}`,
          payload,
        );
        // Commit the server's authoritative timestamp so the LWW guard stays
        // correct on the next delta pull.
        if (localRow && res?.updatedAt) {
          await commitLocalPostEdit(localRow.localId, res.updatedAt);
        }
        kickSync("post-edit");
        router.back();
      } catch (err) {
        // Revert the optimistic write to the pre-edit values.
        if (localRow) {
          await applyLocalPostEdit(localRow.localId, {
            title: prev.title,
            excerpt: prev.excerpt === "" ? null : prev.excerpt,
            body: prev.body,
          });
        }
        setSaving(false);
        Alert.alert(
          "Couldn’t save",
          err instanceof Error ? err.message : "Please try again.",
        );
      }
    },
    [title, excerpt, body, localRow, slug, router, base],
  );

  const cancel = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert("Discard changes?", "Your edits will be lost.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  }, [dirty, router]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: "Edit",
          headerStyle: { backgroundColor: Sirius.color.paper },
          headerTintColor: Sirius.color.ink,
        }}
      />
      {!base ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Sirius.color.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitleEdit}
            style={styles.input}
            placeholder="Title"
            placeholderTextColor={Sirius.color.inkSubtle}
          />

          <Text style={styles.label}>Excerpt</Text>
          <TextInput
            value={excerpt}
            onChangeText={setExcerptEdit}
            style={styles.input}
            placeholder="Optional one-line summary"
            placeholderTextColor={Sirius.color.inkSubtle}
          />

          <Text style={styles.label}>Body (Markdown)</Text>
          <TextInput
            value={body}
            onChangeText={setBodyEdit}
            style={[styles.input, styles.bodyInput]}
            placeholder="Write your post in Markdown…"
            placeholderTextColor={Sirius.color.inkSubtle}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.actions}>
            <Pressable
              onPress={cancel}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [
                styles.cancelBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <View style={styles.primaryActions}>
              {isDraft ? (
                <PrimaryButton
                  label={saving ? "Publishing…" : "Save & Publish"}
                  busy={saving}
                  onPress={() => save(true)}
                />
              ) : (
                <PrimaryButton
                  label={saving ? "Saving…" : "Save"}
                  busy={saving}
                  onPress={() => save(false)}
                />
              )}
            </View>
          </View>
        </ScrollView>
      )}
      <KeyboardDoneButton style={styles.keyboardDone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: Sirius.space.xl, gap: Sirius.space.sm },
  label: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkSubtle,
    marginTop: Sirius.space.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    backgroundColor: Sirius.color.paperRaised,
    paddingHorizontal: Sirius.space.md,
    paddingVertical: Sirius.space.sm,
    fontFamily: Sirius.font.serif,
    fontSize: 16,
    color: Sirius.color.ink,
  },
  bodyInput: {
    minHeight: 320,
    fontFamily: Sirius.font.mono,
    fontSize: 14,
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Sirius.space.md,
    marginTop: Sirius.space.lg,
  },
  primaryActions: { flex: 1, alignItems: "flex-end" },
  cancelBtn: {
    borderWidth: 1,
    borderColor: Sirius.color.rule,
    paddingHorizontal: Sirius.space.lg,
    paddingVertical: Sirius.space.sm,
  },
  cancelText: {
    fontFamily: Sirius.font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: Sirius.color.inkMuted,
  },
  pressed: { opacity: 0.6 },
  keyboardDone: {
    position: "absolute",
    right: Sirius.space.lg,
    bottom: Sirius.space.lg,
  },
});
