// Persistence helpers for the `/llm` chat screen.
//
// These back the `chat_conversations` + `chat_messages` tables — LOCAL-ONLY
// history so the screen restores where it was instead of resetting to empty on
// navigation/restart. Nothing here ever talks to the server; the owner-scoped
// wipe in owner.ts (clearLocalStore) is what isolates one account's chats from
// another's. Since the useChat migration the hook's in-memory messages are the
// truth while a thread is mounted — these helpers are the restore read
// (loadConversationMessages) and the write-behind mirror
// (syncConversationMessages).
import { asc, desc, eq } from "drizzle-orm";

import { rowToUIMessage, textOf, uiMessageToRow } from "../chat/message-map";
import type { ChatUIMessage } from "../chat/types";
import { db } from "./client";
import { chatConversations, chatMessages } from "./schema";

// Conversation titles are derived from the first user message; keep them short
// enough for a one-line thread-list row.
const TITLE_MAX = 60;

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** All messages of a conversation, oldest first, as typed UIMessages. */
export async function loadConversationMessages(
  conversationId: string,
): Promise<ChatUIMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(asc(chatMessages.createdAt));
  return rows.map(rowToUIMessage);
}

/**
 * Write-behind persistence for a useChat thread: replace the conversation's
 * rows with the hook's current messages. Replace-all (delete + insert) keeps
 * regenerate/stop simple — the hook state is the truth, rows just mirror it.
 * Creates the conversation row lazily on first write (so an untouched "new
 * chat" never leaves an empty thread behind) and derives the title from the
 * first user message. Row createdAt encodes array order (base + index) so the
 * asc read restores the exact sequence.
 */
export async function syncConversationMessages(
  conversationId: string,
  messages: ChatUIMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const now = new Date();
  const firstUser = messages.find((m) => m.role === "user");
  const title = firstUser ? deriveTitle(textOf(firstUser)) : null;

  const [existing] = await db
    .select({ id: chatConversations.id, title: chatConversations.title })
    .from(chatConversations)
    .where(eq(chatConversations.id, conversationId))
    .limit(1);

  if (!existing) {
    await db.insert(chatConversations).values({
      id: conversationId,
      title,
      mode: "ask",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(chatConversations)
      .set({ updatedAt: now, ...(existing.title ? {} : { title }) })
      .where(eq(chatConversations.id, conversationId));
  }

  await db
    .delete(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));
  await db
    .insert(chatMessages)
    .values(
      messages.map((m, i) =>
        uiMessageToRow(m, conversationId, new Date(now.getTime() + i)),
      ),
    );
}

/** Delete a conversation and all its messages (manual cascade — FKs are off). */
export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await db
    .delete(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId));
  await db
    .delete(chatConversations)
    .where(eq(chatConversations.id, conversationId));
}

/**
 * The conversation to restore on screen open: the most recently updated one, or
 * null if the user has never chatted (→ empty state, a thread is created lazily
 * on the first send).
 */
export async function getMostRecentConversationId(): Promise<string | null> {
  const [row] = await db
    .select({ id: chatConversations.id })
    .from(chatConversations)
    .orderBy(desc(chatConversations.updatedAt))
    .limit(1);
  return row?.id ?? null;
}
