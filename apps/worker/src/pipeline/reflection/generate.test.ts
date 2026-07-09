// Pure prompt-builder tests for the reflection stage — the personalization
// contract: questions address the author, voice lands as a phrasing aid, and
// corpus context (topics / focus areas / related posts) appears only when
// present so a brand-new user gets a clean material-only prompt.
import { expect, test } from "bun:test";
import { buildReflectionPrompt, type ReflectionContext } from "./generate";

function ctx(overrides: Partial<ReflectionContext> = {}): ReflectionContext {
  return {
    postTitle: "A Study of Bridges",
    postExcerpt: "Bridges are load-bearing.",
    postBody: "## Overview\nBridges carry loads across spans.",
    voiceProfile: null,
    topics: [],
    focusAreas: [],
    related: [],
    ...overrides,
  };
}

test("prompt addresses the author and demands material-specific questions", () => {
  const prompt = buildReflectionPrompt(ctx());
  expect(prompt).toContain("their own take");
  expect(prompt).toContain("3-5 questions");
  expect(prompt).toContain("A Study of Bridges");
  expect(prompt).toContain("Bridges carry loads");
  expect(prompt.toLowerCase()).toContain("never generic filler");
});

test("corpus context sections appear only when non-empty", () => {
  const bare = buildReflectionPrompt(ctx());
  expect(bare).not.toContain("existing topics");
  expect(bare).not.toContain("focus areas");
  expect(bare).not.toContain("closest existing posts");

  const rich = buildReflectionPrompt(
    ctx({
      topics: ["architecture (12)", "engineering (4)"],
      focusAreas: ["Urban design"],
      related: [{ title: "Golden Gate notes", snippet: "suspension spans" }],
    }),
  );
  expect(rich).toContain("architecture (12)");
  expect(rich).toContain("Urban design");
  expect(rich).toContain("Golden Gate notes — suspension spans");
});

test("voice block rides along as a phrasing aid when set", () => {
  const noVoice = buildReflectionPrompt(ctx());
  expect(noVoice).not.toContain("AUTHOR VOICE");

  const voiced = buildReflectionPrompt(
    ctx({ voiceProfile: "Dry wit, short sentences." }),
  );
  expect(voiced).toContain("AUTHOR VOICE");
  expect(voiced).toContain("Dry wit, short sentences.");
});

test("long bodies are truncated in the prompt", () => {
  const prompt = buildReflectionPrompt(ctx({ postBody: "x".repeat(5000) }));
  expect(prompt.length).toBeLessThan(4000);
});
