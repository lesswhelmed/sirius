import { expect, test } from "bun:test";
import { hitToCandidate, ownerNotesBlock, postToFullPost } from "./agent";

test("hitToCandidate maps a search hit to a tool candidate", () => {
  const c = hitToCandidate({
    slug: "my-trip",
    title: "My Trip",
    excerpt: null,
    snippet: "a snippet",
    score: 0.42,
    type: "FINDING",
    status: "PUBLISHED",
    categories: [],
    tags: [],
    submittedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    matchReasons: ["exact"],
  } as never);
  expect(c).toEqual({
    id: "my-trip",
    title: "My Trip",
    excerpt: "a snippet",
    score: 0.42,
  });
});

test("postToFullPost uses content as body and names as tag/category strings", () => {
  const full = postToFullPost({
    slug: "my-trip",
    title: "My Trip",
    content: "the full body",
    excerpt: "blurb",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    tags: [{ name: "travel" }],
    categories: [{ name: "life" }],
  } as never);
  expect(full.id).toBe("my-trip");
  expect(full.body).toBe("the full body");
  expect(full.tags).toEqual(["travel"]);
  expect(full.categories).toEqual(["life"]);
  expect(full.createdAt).toBe("2026-01-01T00:00:00.000Z");
});

test("ownerNotesBlock renders each submission's note text under a labeled trailer", () => {
  const block = ownerNotesBlock([
    { payload: { notes: "the trail where the bridge broke" } },
    { payload: { notes: "" } },
    { payload: { contentType: "image/jpeg" } },
    { payload: { notes: "second note" } },
  ] as never);
  expect(block).toContain("Author's original submission notes");
  expect(block).toContain("the trail where the bridge broke");
  expect(block).toContain("second note");
  expect(block.startsWith("\n---\n")).toBe(true);
});

test("ownerNotesBlock returns empty string when no submission has notes", () => {
  expect(ownerNotesBlock([] as never)).toBe("");
  expect(
    ownerNotesBlock([{ payload: { notes: "  " } }] as never),
  ).toBe("");
});
