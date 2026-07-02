// Pure helpers for the UI-message-stream chat route: request validation, text
// extraction for the model, and wire trimming. Kept separate from the handler
// so they are unit-testable without a session or network (bun test).
import { GET_POST_TOOL_NAME } from "@repo/research-agent";
import type { ModelMessage, UIMessageChunk } from "ai";
import { z } from "zod";

// The posts the agent opened — streamed to the client as the
// `data-source-posts` part and rendered as tappable Sources.
export interface ChatSource {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

// Loose validation of the standard useChat request body. Parts are validated
// only as tagged objects — toModelMessages only reads text parts, and unknown
// part types must not reject a request from a newer client.
const wirePartSchema = z.looseObject({ type: z.string() });

const wireMessageSchema = z.looseObject({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(wirePartSchema),
});

export const chatBodySchema = z.looseObject({
  id: z.string().optional(),
  messages: z.array(wireMessageSchema).min(1).max(100),
});

export type WireUIMessage = z.infer<typeof wireMessageSchema>;

// History for the model = the flat text of each turn (matches the pre-migration
// behavior). Tool parts and data parts never replay to the model; a message
// with no text (e.g. an aborted empty turn) is dropped entirely.
export function toModelMessages(messages: WireUIMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    const text = m.parts
      .filter(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" &&
          typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("\n\n");
    if (text.length === 0) continue;
    out.push({ role: m.role, content: text } as ModelMessage);
  }
  return out;
}

// get_post tool outputs carry FULL post bodies for the model; the client only
// needs the fact that the tool ran (the Sources data part carries the display
// payload). Replace those outputs on the wire so bodies aren't streamed to —
// and persisted on — the device. toolName only appears on the input chunks, so
// track toolCallId → toolName as chunks pass through.
export function makeToolOutputTrimmer(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  const toolNameById = new Map<string, string>();
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      const c = chunk as {
        type: string;
        toolCallId?: string;
        toolName?: string;
      };
      if (typeof c.toolCallId === "string" && typeof c.toolName === "string") {
        toolNameById.set(c.toolCallId, c.toolName);
      }
      if (
        c.type === "tool-output-available" &&
        typeof c.toolCallId === "string" &&
        toolNameById.get(c.toolCallId) === GET_POST_TOOL_NAME
      ) {
        controller.enqueue({
          ...chunk,
          output: { trimmed: true },
        } as UIMessageChunk);
        return;
      }
      controller.enqueue(chunk);
    },
  });
}
