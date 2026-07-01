import { expect, test } from "bun:test";
import { hitToCandidate, postToFullPost } from "./agent";

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
