// Pure-module tests (no react-native imports) — runs under plain `bun test`,
// same pattern as lib/chat/message-map.test.ts.
import { describe, expect, test } from "bun:test";

import type { ReflectionPromptDelta, ReflectionResponseDelta } from "./events";
import { promptDeltaToRow, responseDeltaToRow } from "./reflection-map";

const promptDelta: ReflectionPromptDelta = {
  id: "prompt-1",
  postId: "post-1",
  postSlug: "my-post",
  batchId: "batch-1",
  order: 2,
  question: "What surprised you?",
  rationale: "Sharpens recall.",
  status: "active",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-02T11:30:00.000Z",
};

const responseDelta: ReflectionResponseDelta = {
  id: "resp-1",
  promptId: "prompt-1",
  postId: "post-1",
  postSlug: "my-post",
  body: "The ending.",
  hasAudio: true,
  createdAt: "2026-07-03T09:00:00.000Z",
  updatedAt: "2026-07-03T09:05:00.000Z",
};

describe("promptDeltaToRow", () => {
  test("maps the wire shape onto the mirror row", () => {
    const row = promptDeltaToRow(promptDelta);
    expect(row).toEqual({
      serverId: "prompt-1",
      postSlug: "my-post",
      postId: "post-1",
      batchId: "batch-1",
      order: 2,
      question: "What surprised you?",
      rationale: "Sharpens recall.",
      status: "active",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-02T11:30:00.000Z"),
    });
  });

  test("coalesces omitted nullables to null (never undefined — expo-sqlite rejects it)", () => {
    const row = promptDeltaToRow({
      ...promptDelta,
      rationale: undefined as unknown as null,
      postId: undefined as unknown as string,
    });
    expect(row.rationale).toBeNull();
    expect(row.postId).toBeNull();
  });

  test("passes superseded through; anything unexpected falls back to active", () => {
    expect(promptDeltaToRow({ ...promptDelta, status: "superseded" }).status).toBe(
      "superseded",
    );
    expect(
      promptDeltaToRow({
        ...promptDelta,
        status: "bogus" as unknown as "active",
      }).status,
    ).toBe("active");
  });

  test("accepts Date objects for timestamps (better-fetch revives ISO strings)", () => {
    const revived = promptDeltaToRow({
      ...promptDelta,
      updatedAt: new Date("2026-07-02T11:30:00.000Z") as unknown as string,
    });
    expect(revived.updatedAt).toEqual(new Date("2026-07-02T11:30:00.000Z"));
  });
});

describe("responseDeltaToRow", () => {
  test("maps the wire shape onto the mirror row (promptId → promptServerId)", () => {
    const row = responseDeltaToRow(responseDelta);
    expect(row).toEqual({
      serverId: "resp-1",
      promptServerId: "prompt-1",
      postSlug: "my-post",
      body: "The ending.",
      hasAudio: true,
      createdAt: new Date("2026-07-03T09:00:00.000Z"),
      updatedAt: new Date("2026-07-03T09:05:00.000Z"),
    });
  });

  test("hasAudio is a strict boolean; omitted body coalesces to empty string", () => {
    const row = responseDeltaToRow({
      ...responseDelta,
      hasAudio: undefined as unknown as boolean,
      body: undefined as unknown as string,
    });
    expect(row.hasAudio).toBe(false);
    expect(row.body).toBe("");
  });
});
