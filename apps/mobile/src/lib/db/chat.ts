// Persistence helpers for the on-device LLM chat (the `/llm` screen).
//
// These back the `chat_conversations` + `chat_messages` tables — LOCAL-ONLY
// history so the screen restores where it was instead of resetting to empty on
// navigation/restart. Nothing here ever talks to the server; the owner-scoped
// wipe in owner.ts (clearLocalStore) is what isolates one account's chats from
// another's. The UI reads these tables reactively via Drizzle's useLiveQuery —
// these helpers are the write side + the "what to restore" read.
import type { ScoredPost } from "@repo/research-agent";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";

import { db } from "./client";
import { chatConversations, chatMessages } from "./schema";

export type ChatRole = "user" | "assistant";
export type ChatMode = "ask" | "chat";

// Conversation titles are derived from the first user message; keep them short
// enough for a one-line thread-list row.
const TITLE_MAX = 60;

function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** Create a new (empty, untitled) conversation and return its id. */
export async function createConversation(mode: ChatMode): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db
    .insert(chatConversations)
    .values({ id, title: null, mode, createdAt: now, updatedAt: now });
  return id;
}

/**
 * Append a message to a conversation. Bumps the conversation's `updatedAt` (so
 * it sorts to the top of the thread list and is the one restored on return) and,
 * for the FIRST user message, sets the conversation title from it. Persist the
 * user message BEFORE generation starts so the question survives even if the app
 * is killed mid-stream; persist the assistant message once it completes.
 */
export async function appendMessage(
  conversationId: string,
  message: { role: ChatRole; content: string; sources?: ScoredPost[] | null },
): Promise<void> {
  const now = new Date();
  await db.insert(chatMessages).values({
    id: randomUUID(),
    conversationId,
    role: message.role,
    content: message.content,
    sourcesJson: message.sources ?? null,
    createdAt: now,
  });

  const update: { updatedAt: Date; title?: string } = { updatedAt: now };
  if (message.role === "user") {
    const [convo] = await db
      .select({ title: chatConversations.title })
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId))
      .limit(1);
    if (convo && !convo.title) update.title = deriveTitle(message.content);
  }
  await db
    .update(chatConversations)
    .set(update)
    .where(eq(chatConversations.id, conversationId));
}

/** Remember the last selected mode so the toggle restores when the thread reopens. */
export async function setConversationMode(
  conversationId: string,
  mode: ChatMode,
): Promise<void> {
  await db
    .update(chatConversations)
    .set({ mode })
    .where(eq(chatConversations.id, conversationId));
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
