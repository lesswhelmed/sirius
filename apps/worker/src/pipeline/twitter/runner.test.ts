// Prompt-builder tests only — buildTwitterPrompt is the pure, durable
// transformation (the Apify fetch + Gemini call around it need live services).
// Guards the raw-analysis pivot: neutral analyst contract embedded, no voiced
// first-person framing, anti-fabrication line intact.

import { describe, expect, test } from "bun:test";

import { buildTwitterPrompt } from "./runner";
import type { TwitterEvidence } from "./types";

function makeEvidence(overrides: Partial<TwitterEvidence> = {}): TwitterEvidence {
  return {
    tweetId: "1234567890",
    url: "https://x.com/somebody/status/1234567890",
    createdAt: "2026-07-01T12:00:00.000Z",
    lang: "en",
    text: "Shipping the new release today. Threads about the migration to follow.",
    quotedText: null,
    isReply: null,
    isRetweet: null,
    isQuote: null,
    likeCount: 42,
    retweetCount: 7,
    replyCount: 3,
    quoteCount: null,
    viewCount: null,
    primaryImageUrl: null,
    mediaUrls: [],
    article: null,
    author: {
      username: "somebody",
      name: "Some Body",
      id: "99",
      isVerified: true,
      followerCount: 1000,
      profileImageUrl: null,
    },
    raw: {},
    ...overrides,
  };
}

describe("buildTwitterPrompt (plain tweet)", () => {
  const prompt = buildTwitterPrompt(makeEvidence(), "");

  test("embeds the raw-analysis contract", () => {
    expect(prompt).toContain("RAW ANALYSIS");
    expect(prompt).toContain("## Full breakdown");
    expect(prompt).toContain("an X/Twitter post (from the fetched data below)");
    expect(prompt).toContain("neutral analyst");
  });

  test("no voiced/first-person framing and no voice block", () => {
    expect(prompt.toLowerCase()).not.toContain("first person");
    expect(prompt).not.toContain("AUTHOR VOICE");
    expect(prompt).not.toContain("<voice>");
  });

  test("keeps the anti-fabrication instruction", () => {
    expect(prompt).toContain(
      "Do not fabricate engagement numbers, claims, or context beyond the evidence below.",
    );
  });

  test("breakdown asks for ordered reconstruction, attributed verbatim quotes, and data-gated signals", () => {
    expect(prompt).toContain("reconstructed in order");
    expect(prompt).toContain("attributed to @somebody");
    expect(prompt).toContain("ONLY if present in the fetched data");
  });

  test("embeds the tweet evidence", () => {
    expect(prompt).toContain("## Tweet evidence");
    expect(prompt).toContain("Some Body (@somebody)");
    expect(prompt).toContain("Shipping the new release today.");
    expect(prompt).toContain("Engagement: 42 likes, 7 reposts, 3 replies");
  });

  test("omits the engagement line when no counts are present", () => {
    const bare = buildTwitterPrompt(
      makeEvidence({
        likeCount: null,
        retweetCount: null,
        replyCount: null,
        quoteCount: null,
      }),
      "",
    );
    expect(bare).not.toContain("Engagement:");
  });
});

describe("buildTwitterPrompt (X Article)", () => {
  const evidence = makeEvidence({
    article: {
      title: "Why local-first sync wins",
      previewText: "A look at local-first architectures.",
      body: "Local-first sync keeps the source of truth on device.\n\nServers become sync brokers.",
      coverImageUrl: null,
    },
  });
  const prompt = buildTwitterPrompt(evidence, "");

  test("frames the Article variant of the contract", () => {
    expect(prompt).toContain("RAW ANALYSIS");
    expect(prompt).toContain("long-form X Article");
    expect(prompt).toContain("## Full breakdown");
    expect(prompt).toContain("analyze the Article body, not the link");
  });

  test("embeds the article title and body", () => {
    expect(prompt).toContain("## Linked X Article (the primary content)");
    expect(prompt).toContain("Why local-first sync wins");
    expect(prompt).toContain("Servers become sync brokers.");
  });

  test("still carries no voiced framing", () => {
    expect(prompt.toLowerCase()).not.toContain("first person");
    expect(prompt).not.toContain("AUTHOR VOICE");
  });
});

describe("buildTwitterPrompt (notes lead)", () => {
  test("leads with the author's note before the tweet evidence", () => {
    const prompt = buildTwitterPrompt(makeEvidence(), "saved for the migration checklist");
    const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
    const evidenceIdx = prompt.indexOf("## Tweet evidence");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(prompt).toContain("saved for the migration checklist");
    expect(noteIdx).toBeLessThan(evidenceIdx);
  });

  test("omits the note block when notes are empty", () => {
    const prompt = buildTwitterPrompt(makeEvidence(), "   ");
    expect(prompt).not.toContain("AUTHOR'S NOTE");
  });
});
