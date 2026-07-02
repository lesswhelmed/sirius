// Pure UIMessage ↔ chat_messages-row mapping (no react-native imports — unit
// tested under bun). New rows persist full parts JSON; rows written before the
// useChat migration have partsJson null and are reconstructed from the legacy
// content + sourcesJson columns.
import type { ChatMessageRow, NewChatMessageRow } from "../db/schema";
import type { ChatUIMessage, SourcePost } from "./types";

export function textOf(msg: ChatUIMessage): string {
  return msg.parts
    .filter(
      (p): p is Extract<ChatUIMessage["parts"][number], { type: "text" }> =>
        p.type === "text",
    )
    .map((p) => p.text)
    .join("\n\n");
}

export function rowToUIMessage(row: ChatMessageRow): ChatUIMessage {
  if (row.partsJson && Array.isArray(row.partsJson)) {
    return {
      id: row.id,
      role: row.role,
      parts: row.partsJson as ChatUIMessage["parts"],
    };
  }
  const parts: ChatUIMessage["parts"] = [{ type: "text", text: row.content }];
  if (row.sourcesJson && row.sourcesJson.length > 0) {
    const data: SourcePost[] = row.sourcesJson.map((s) => ({
      serverId: s.serverId,
      slug: s.slug,
      title: s.title,
      excerpt: s.excerpt,
    }));
    parts.push({ type: "data-source-posts", id: "sources", data });
  }
  return { id: row.id, role: row.role, parts };
}

export function uiMessageToRow(
  msg: ChatUIMessage,
  conversationId: string,
  createdAt: Date,
): NewChatMessageRow {
  return {
    id: msg.id,
    conversationId,
    role: msg.role === "user" ? "user" : "assistant",
    content: textOf(msg),
    sourcesJson: null,
    partsJson: msg.parts,
    createdAt,
  };
}
