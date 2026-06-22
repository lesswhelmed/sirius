// Comments thread for the post detail screen. Offline-first: the list is a live
// query over the local `comments` mirror (renders instantly, updates as the sync
// engine reconciles server deltas), and posting inserts an optimistic row +
// queues the POST so it works with no connection. Owner-only (the whole app's
// post surface is owner-scoped), so every comment here is the current user's.
import { and, asc, eq, ne } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useState } from "react";
import {
  ActivityIndicator,
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
} from "@/components/sirius";
import type { Theme } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/constants/theme-context";
import { apiDelete, ApiError } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { enqueueCommentOutbox } from "@/lib/comment-outbox";
import { db } from "@/lib/db/client";
import { type CommentRow, comments } from "@/lib/db/schema";
import { applyCommentTombstone } from "@/lib/sync/comment-reconcile";
import { createLocalCommentDraft } from "@/lib/sync/comment-writes";
import { kickSync } from "@/lib/sync/engine";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function stateNote(row: CommentRow): string | null {
  switch (row.syncState) {
    case "local_draft":
    case "pending":
      return "Sending…";
    case "failed":
      return "Failed to send";
    default:
      return null;
  }
}

export function CommentsSection({ postSlug }: { postSlug: string }) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;
  const myLabel = session?.user?.name ?? "You";

  const { data: rows } = useLiveQuery(
    db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.postSlug, postSlug),
          ne(comments.syncState, "tombstone"),
        ),
      )
      .orderBy(asc(comments.createdAt)),
  );

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const list = rows ?? [];

  const onSubmit = async () => {
    const trimmed = body.trim();
    if (trimmed.length === 0 || !currentUserId) return;
    setBusy(true);
    try {
      const localId = await createLocalCommentDraft({
        postSlug,
        body: trimmed,
        authorId: currentUserId,
        authorLabel: myLabel,
      });
      await enqueueCommentOutbox({ localId, postSlug, body: trimmed });
      setBody("");
      // Trigger the sync loop so the POST flushes now (it also reconciles the
      // canonical comment back into this row); offline, it stays queued.
      kickSync("comment-posted");
    } finally {
      setBusy(false);
    }
  };

  // Delete is online-only for v1: tombstone on the server, then optimistically
  // hide locally (the next pull confirms it). Only synced comments are deletable.
  const onDelete = async (row: CommentRow) => {
    if (!row.serverId) return;
    try {
      await apiDelete(`/api/app/posts/${postSlug}/comments/${row.serverId}`);
      await applyCommentTombstone(row.serverId, new Date().toISOString());
    } catch (err) {
      if (err instanceof ApiError) {
        console.warn(`[comments] delete failed (${err.status})`);
      }
    }
  };

  return (
    <View style={styles.section}>
      <Eyebrow>
        Conversation{list.length > 0 ? ` · ${list.length}` : ""}
      </Eyebrow>

      <View style={styles.list}>
        {list.length === 0 ? (
          <Text style={styles.empty}>
            No comments yet — start the conversation.
          </Text>
        ) : (
          list.map((row) => {
            const note = stateNote(row);
            const mine = row.authorId === currentUserId;
            return (
              <View key={row.localId} style={styles.comment}>
                <View style={styles.commentHead}>
                  <Text style={styles.author}>{row.authorLabel ?? "You"}</Text>
                  <View style={styles.metaRight}>
                    <Text style={styles.date}>
                      {dateFmt.format(new Date(row.createdAt))}
                    </Text>
                    {mine && row.serverId ? (
                      <Pressable
                        onPress={() => onDelete(row)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete comment"
                      >
                        <Text style={styles.delete}>Delete</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <Text style={styles.body}>{row.body}</Text>
                {note ? (
                  <Text
                    style={[
                      styles.note,
                      row.syncState === "failed" ? styles.noteFailed : null,
                    ]}
                  >
                    {note}
                  </Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <Field
        label="Add a comment"
        placeholder="Your thoughts…"
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={5000}
        editable={!busy}
      />
      <KeyboardDoneButton />
      <PrimaryButton
        label="Post comment"
        busy={busy}
        disabled={body.trim().length === 0 || !currentUserId}
        onPress={onSubmit}
      />
      {busy ? (
        <ActivityIndicator color={t.color.accent} style={styles.spinner} />
      ) : null}
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
      gap: t.space.md,
    },
    list: { gap: t.space.lg },
    empty: {
      fontFamily: t.font.serif,
      fontSize: 16,
      fontStyle: "italic",
      color: t.color.inkMuted,
    },
    comment: {
      gap: t.space.xs,
      borderBottomWidth: 1,
      borderBottomColor: t.color.rule,
      paddingBottom: t.space.md,
    },
    commentHead: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: t.space.sm,
    },
    author: {
      fontFamily: t.font.mono,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.accent,
    },
    metaRight: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: t.space.md,
    },
    date: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    delete: {
      fontFamily: t.font.mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.inkSubtle,
    },
    body: {
      fontFamily: t.font.serif,
      fontSize: 16,
      lineHeight: 24,
      color: t.color.ink,
    },
    note: {
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.inkSubtle,
    },
    noteFailed: { color: t.color.accent },
    spinner: { alignSelf: "flex-start" },
  });
}
