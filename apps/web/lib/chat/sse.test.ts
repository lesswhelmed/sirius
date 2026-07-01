import { expect, test } from "bun:test";
import { chatBodySchema, encodeFrame } from "./sse";

test("encodeFrame emits one SSE data line with JSON payload", () => {
  expect(encodeFrame({ t: "token", v: "hi" })).toBe(
    `data: ${JSON.stringify({ t: "token", v: "hi" })}\n\n`,
  );
});

test("chatBodySchema rejects an empty message list", () => {
  expect(chatBodySchema.safeParse({ messages: [] }).success).toBe(false);
});

test("chatBodySchema accepts a valid user turn", () => {
  const r = chatBodySchema.safeParse({
    messages: [{ role: "user", content: "hello" }],
  });
  expect(r.success).toBe(true);
});
