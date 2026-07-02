// bun test for the pure chat-route helpers (schema, text extraction, wire
// trimming). Excluded from tsc like the other bun:test files in this app.
import { describe, expect, test } from "bun:test";
import type { UIMessageChunk } from "ai";

import {
  chatBodySchema,
  makeToolOutputTrimmer,
  toModelMessages,
} from "./ui-stream";

const userMsg = (text: string) => ({
  id: "u1",
  role: "user" as const,
  parts: [{ type: "text", text }],
});

describe("chatBodySchema", () => {
  test("accepts a useChat body and ignores extras", () => {
    const parsed = chatBodySchema.safeParse({
      id: "chat-1",
      trigger: "submit-message",
      messages: [userMsg("hi")],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects empty messages", () => {
    expect(chatBodySchema.safeParse({ messages: [] }).success).toBe(false);
  });

  test("rejects a message without parts", () => {
    const parsed = chatBodySchema.safeParse({
      messages: [{ id: "u1", role: "user" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("toModelMessages", () => {
  test("keeps only text parts, joins multiples, drops empty messages", () => {
    const messages = [
      userMsg("What did I save about kelp?"),
      {
        id: "a1",
        role: "assistant" as const,
        parts: [
          {
            type: "tool-search_posts",
            toolCallId: "t1",
            state: "output-available",
          },
          { type: "text", text: "You saved" },
          { type: "text", text: "two posts." },
          { type: "data-source-posts", data: [] },
        ],
      },
      { id: "a2", role: "assistant" as const, parts: [{ type: "step-start" }] },
    ];
    expect(toModelMessages(messages as never)).toEqual([
      { role: "user", content: "What did I save about kelp?" },
      { role: "assistant", content: "You saved\n\ntwo posts." },
    ]);
  });
});

async function pump(chunks: UIMessageChunk[]): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  }).pipeThrough(makeToolOutputTrimmer());
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("makeToolOutputTrimmer", () => {
  test("trims get_post outputs, leaves search_posts outputs alone", async () => {
    const chunks = [
      { type: "tool-input-start", toolCallId: "s1", toolName: "search_posts" },
      {
        type: "tool-output-available",
        toolCallId: "s1",
        output: { posts: [{ id: "p" }] },
      },
      { type: "tool-input-start", toolCallId: "g1", toolName: "get_post" },
      {
        type: "tool-output-available",
        toolCallId: "g1",
        output: { post: { body: "HUGE" } },
      },
      { type: "text-delta", id: "t", delta: "hi" },
    ] as unknown as UIMessageChunk[];
    const out = await pump(chunks);
    expect(out[1]).toMatchObject({ output: { posts: [{ id: "p" }] } });
    expect(out[3]).toMatchObject({ output: { trimmed: true } });
    expect(out[4]).toMatchObject({ type: "text-delta" });
  });
});
