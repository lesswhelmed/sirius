// Pure-module tests (no react-native imports) — runs under plain `bun test`,
// same pattern as nav-dedupe.test.ts.
import { describe, expect, test } from "bun:test";

import type { ChatMessageRow } from "../db/schema";
import { rowToUIMessage, textOf, uiMessageToRow } from "./message-map";
import type { ChatUIMessage } from "./types";

const baseRow: ChatMessageRow = {
  id: "m1",
  conversationId: "c1",
  role: "assistant",
  content: "Hello there.",
  sourcesJson: null,
  partsJson: null,
  createdAt: new Date(1_700_000_000_000),
};

describe("rowToUIMessage", () => {
  test("legacy row → one text part", () => {
    expect(rowToUIMessage(baseRow)).toEqual({
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Hello there." }],
    });
  });

  test("legacy row with sourcesJson → trailing data-source-posts part", () => {
    const row = {
      ...baseRow,
      sourcesJson: [
        { serverId: "s", slug: "s", title: "T", excerpt: "E", score: 0 },
      ],
    };
    const msg = rowToUIMessage(row as ChatMessageRow);
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[1]).toEqual({
      type: "data-source-posts",
      id: "sources",
      data: [{ serverId: "s", slug: "s", title: "T", excerpt: "E" }],
    });
  });

  test("partsJson row wins over legacy columns", () => {
    const parts = [{ type: "text", text: "from parts" }];
    const msg = rowToUIMessage({
      ...baseRow,
      partsJson: parts,
    } as ChatMessageRow);
    expect(msg.parts).toEqual(parts as ChatUIMessage["parts"]);
  });
});

describe("uiMessageToRow / textOf", () => {
  test("round-trips parts and flattens text into content", () => {
    const msg: ChatUIMessage = {
      id: "m2",
      role: "assistant",
      parts: [
        { type: "text", text: "part one" },
        { type: "text", text: "part two" },
      ],
    };
    const row = uiMessageToRow(msg, "c1", new Date(123));
    expect(row).toEqual({
      id: "m2",
      conversationId: "c1",
      role: "assistant",
      content: "part one\n\npart two",
      sourcesJson: null,
      partsJson: msg.parts,
      createdAt: new Date(123),
    });
    expect(textOf(msg)).toBe("part one\n\npart two");
  });
});
