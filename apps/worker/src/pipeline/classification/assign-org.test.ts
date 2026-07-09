// Black-box tests for the pure scene-row observability decision. No DB, no
// Gemini: just the rule that turns an assignOrg outcome into a one-line warning
// when an ELIGIBLE ingest landed with no PostEmbedding/PostCategoryMatch rows
// (so a prod worker silently writing nothing to the embedding space is visible).
import { expect, test } from "bun:test";
import { type AssignOrgResult, sceneRowWarning } from "./assign-org";

function result(overrides: Partial<AssignOrgResult>): AssignOrgResult {
  return {
    postEmbeddingWritten: true,
    categoryMatchCount: 1,
    project: null,
    skipped: null,
    contentEmbedding: null,
    ...overrides,
  };
}

test("a known skip (disabled/unattributed) is NOT flagged", () => {
  expect(
    sceneRowWarning(
      result({
        skipped: "disabled",
        postEmbeddingWritten: false,
        categoryMatchCount: 0,
      }),
    ),
  ).toBeNull();
  expect(
    sceneRowWarning(
      result({
        skipped: "unattributed",
        postEmbeddingWritten: false,
        categoryMatchCount: 0,
      }),
    ),
  ).toBeNull();
});

test("eligible ingest with embedding + at least one match is NOT flagged", () => {
  expect(
    sceneRowWarning(
      result({ postEmbeddingWritten: true, categoryMatchCount: 3 }),
    ),
  ).toBeNull();
});

test("eligible ingest with no PostEmbedding IS flagged", () => {
  expect(
    sceneRowWarning(
      result({ postEmbeddingWritten: false, categoryMatchCount: 0 }),
    ),
  ).toBe("no PostEmbedding written");
});

test("eligible ingest with an embedding but zero category matches IS flagged (absent from Tree)", () => {
  expect(
    sceneRowWarning(
      result({ postEmbeddingWritten: true, categoryMatchCount: 0 }),
    ),
  ).toBe("no PostCategoryMatch rows (post absent from Tree)");
});

test("an assigned project does not suppress a zero-match warning", () => {
  // Project assignment and scene-row linkage are independent — a post can be
  // filed under a Project yet still carry no category matches.
  expect(
    sceneRowWarning(
      result({
        project: { projectId: "p1", created: true },
        categoryMatchCount: 0,
      }),
    ),
  ).toBe("no PostCategoryMatch rows (post absent from Tree)");
});
