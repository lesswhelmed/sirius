// Run with: bun test src/lib/research/chat-stream.test.ts  (from apps/mobile)
//
// Imports parseSseChunk from the pure sibling module (sse-parse.ts), NOT from
// chat-stream.ts: chat-stream.ts's top-level imports (expo/fetch, @/lib/api)
// chain into react-native and break bun's parser (Flow syntax in
// react-native/index.js) the moment the module loads — same reasoning as
// nav.test.ts importing from nav-dedupe.ts instead of nav.ts. Verified this
// empirically before splitting the file.
import { expect, test } from "bun:test";

import { parseSseChunk } from "./sse-parse";

test("parseSseChunk extracts complete frames and keeps the partial remainder", () => {
  const full =
    `data: ${JSON.stringify({ t: "token", v: "he" })}\n\n` +
    `data: ${JSON.stringify({ t: "token", v: "llo" })}\n\n` +
    `data: {"t":"to`; // partial trailing frame
  const { frames, rest } = parseSseChunk(full);
  expect(frames).toEqual([
    { t: "token", v: "he" },
    { t: "token", v: "llo" },
  ]);
  expect(rest).toBe(`data: {"t":"to`);
});

test("parseSseChunk returns no frames and the whole buffer as rest when nothing is complete", () => {
  const partial = `data: {"t":"token"`;
  const { frames, rest } = parseSseChunk(partial);
  expect(frames).toEqual([]);
  expect(rest).toBe(partial);
});

test("parseSseChunk skips a malformed frame but keeps parsing the rest", () => {
  const full =
    `data: not-json\n\n` +
    `data: ${JSON.stringify({ t: "done" })}\n\n`;
  const { frames, rest } = parseSseChunk(full);
  expect(frames).toEqual([{ t: "done" }]);
  expect(rest).toBe("");
});

test("parseSseChunk parses a sources frame", () => {
  const sources = [
    { serverId: "1", slug: "a", title: "A", excerpt: null },
  ];
  const full = `data: ${JSON.stringify({ t: "sources", v: sources })}\n\n`;
  const { frames, rest } = parseSseChunk(full);
  expect(frames).toEqual([{ t: "sources", v: sources }]);
  expect(rest).toBe("");
});
