// Owner post-body editor. Reached via the "Content · Edit ▸" row on the detail
// screen. Local-mirror-first like the detail view: it reads from the on-device
// row (instant, offline) and writes back through the SAME PATCH route the web
// editor uses. The mirror reconciliation is LWW-safe — we optimistically update
// the local body but only ever commit serverUpdatedAt from the PATCH response's
// authoritative timestamp (see commitLocalPostEdit), never a client guess.
//
// UX: the body is a full-height writing canvas (a markdown editor, not a tiny
// form box). It owns its own scroll and the screen pads its bottom by the live
// keyboard height, so the caret is always visible above the keyboard and a
// formatting toolbar docks flush on top of the keys. Save/Cancel live in the nav
// header so the bottom is free for the toolbar.
import type { Category, Post, Tag } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { and, eq, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MarkdownToolbar } from "@/components/markdown-toolbar";
import { Screen } from "@/components/sirius";
import { Sirius } from "@/constants/theme";
import { apiGet, apiPatch } from "@/lib/api";
import { db } from "@/lib/db/client";
import { posts } from "@/lib/db/schema";
import {
  applyMarkdownCommand,
  type MarkdownCommand,
  type Selection,
} from "@/lib/markdown-edit";
import { kickSync } from "@/lib/sync/engine";
import { applyLocalPostEdit, commitLocalPostEdit } from "@/lib/sync/writes";

type PostDetail = Post & { tags: Tag[]; categories: Category[] };
type PatchResult = { updatedAt?: string; status?: string };

// Live soft-keyboard height (0 when hidden). We pad the editor's bottom by this
// so the body canvas shrinks to fit above the keyboard and the toolbar lands
// flush on top of it. iOS uses the will-* events so the layout moves with the
// keyboard animation; Android uses did-* (no will-* there).
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const isIOS = Platform.OS === "ios";
    const showEvent = isIOS ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = isIOS ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) =>
      setHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setHeight(0);
    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export default function EditPostScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

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

  // Body editor state. selRef tracks the live caret/selection for toolbar
  // transforms WITHOUT re-rendering on every cursor move. pendingSelection is a
  // one-shot controlled-selection override applied only right after a toolbar
  // command moves the caret; it's cleared on the next selection event so normal
  // typing stays uncontrolled (a permanently controlled selection fights the
  // native input and makes the caret jump).
  const selRef = useRef<Selection>({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(
    null,
  );
  const [bodyFocused, setBodyFocused] = useState(false);

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

  const onSelectionChange = useCallback(
    (e: { nativeEvent: { selection: Selection } }) => {
      selRef.current = e.nativeEvent.selection;
      // Release the one-shot override once the native input has applied it.
      setPendingSelection((prev) => (prev ? null : prev));
    },
    [],
  );

  const runCommand = useCallback(
    (command: MarkdownCommand) => {
      const result = applyMarkdownCommand(command, body, selRef.current);
      setBodyEdit(result.text);
      selRef.current = result.selection;
      setPendingSelection(result.selection);
    },
    [body],
  );

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

  const primaryLabel = isDraft ? "Publish" : "Save";
  // Publishing a draft is a state change, so allow it even when text is clean;
  // a plain Save is pointless with no edits.
  const primaryDisabled = saving || (!isDraft && !dirty);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: isDraft ? "Edit draft" : "Edit",
          headerStyle: { backgroundColor: Sirius.color.paper },
          headerTintColor: Sirius.color.ink,
          headerLeft: () => (
            <Pressable
              onPress={cancel}
              disabled={saving}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.headerCancel}>Cancel</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => save(isDraft)}
              disabled={primaryDisabled}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
              accessibilityState={{ disabled: primaryDisabled, busy: saving }}
              style={({ pressed }) => pressed && styles.pressed}
            >
              {saving ? (
                <ActivityIndicator color={Sirius.color.accent} />
              ) : (
                <Text
                  style={[
                    styles.headerSave,
                    primaryDisabled && styles.headerSaveDisabled,
                  ]}
                >
                  {primaryLabel}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />
      {!base ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Sirius.color.accent} />
        </View>
      ) : (
        <View
          style={[
            styles.editor,
            // Reserve the keyboard's footprint so the canvas shrinks to fit and
            // the toolbar sits just above the keys; clear of the home indicator
            // when the keyboard is down.
            { paddingBottom: keyboardHeight > 0 ? keyboardHeight : insets.bottom },
          ]}
        >
          <View style={styles.fields}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitleEdit}
              style={styles.input}
              placeholder="Title"
              placeholderTextColor={Sirius.color.inkSubtle}
              selectionColor={Sirius.color.accent}
              accessibilityLabel="Title"
            />

            <Text style={styles.label}>Excerpt</Text>
            <TextInput
              value={excerpt}
              onChangeText={setExcerptEdit}
              style={styles.input}
              placeholder="Optional one-line summary"
              placeholderTextColor={Sirius.color.inkSubtle}
              selectionColor={Sirius.color.accent}
              accessibilityLabel="Excerpt"
            />
          </View>

          <View style={styles.canvasHeader}>
            <Text style={styles.label}>Body · Markdown</Text>
          </View>
          <TextInput
            value={body}
            onChangeText={setBodyEdit}
            onSelectionChange={onSelectionChange}
            selection={pendingSelection ?? undefined}
            onFocus={() => setBodyFocused(true)}
            onBlur={() => setBodyFocused(false)}
            style={styles.body}
            placeholder="Write your post in Markdown…"
            placeholderTextColor={Sirius.color.inkSubtle}
            selectionColor={Sirius.color.accent}
            multiline
            scrollEnabled
            textAlignVertical="top"
            accessibilityLabel="Body, Markdown"
          />

          {bodyFocused ? (
            <MarkdownToolbar onCommand={runCommand} onDone={Keyboard.dismiss} />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  editor: { flex: 1 },
  fields: {
    paddingHorizontal: Sirius.space.xl,
    paddingTop: Sirius.space.lg,
    gap: Sirius.space.sm,
  },
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
  // A ruled divider that turns the lower half of the screen into the writing
  // canvas, visually separate from the compact form fields above.
  canvasHeader: {
    marginTop: Sirius.space.md,
    paddingHorizontal: Sirius.space.xl,
    paddingBottom: Sirius.space.xs,
    borderTopWidth: 1,
    borderTopColor: Sirius.color.ruleStrong,
  },
  // Borderless full-height canvas (not a small boxed field) so it reads as an
  // editor; it owns its own scroll, keeping the caret visible above the keyboard.
  body: {
    flex: 1,
    paddingHorizontal: Sirius.space.xl,
    paddingTop: Sirius.space.xs,
    fontFamily: Sirius.font.mono,
    fontSize: 15,
    lineHeight: 24,
    color: Sirius.color.ink,
  },
  pressed: { opacity: 0.5 },
  headerCancel: {
    fontFamily: Sirius.font.mono,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Sirius.color.inkMuted,
  },
  headerSave: {
    fontFamily: Sirius.font.mono,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Sirius.color.accent,
  },
  headerSaveDisabled: { color: Sirius.color.inkFaint },
});
