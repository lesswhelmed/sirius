// Pure SSE framing + request validation for the chat route. Kept separate from the
// handler so the framing/schema are unit-testable without a session or network.
import { z } from "zod";

export interface ChatSource {
  serverId: string;
  slug: string;
  title: string;
  excerpt: string | null;
}

export type ChatFrame =
  | { t: "token"; v: string }
  | { t: "sources"; v: ChatSource[] }
  | { t: "error"; v: string }
  | { t: "done" };

// One SSE event per frame. The mobile parser splits the stream on the blank line.
export function encodeFrame(event: ChatFrame): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(100),
});

export type ChatBody = z.infer<typeof chatBodySchema>;
