// Pure prompt-builder tests for the YouTube structuring call — the durable
// transformation of the raw-analysis pivot. No network, no model.

import { describe, expect, test } from "bun:test";
import { parseYouTubeUrl } from "../../lib/youtube-url";
import { buildStructuringPrompt, type YouTubeEvidence } from "./runner";

function makeEvidence(
  overrides: Partial<YouTubeEvidence> = {},
): YouTubeEvidence {
  const parse = parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  if (!parse) {
    throw new Error("test URL failed to parse");
  }
  return {
    parse,
    metadata: {
      videoId: parse.videoId,
      title: "Building a Compiler in a Weekend",
      channelTitle: "Systems Garage",
      channelId: "UC123",
      publishedAt: "2026-05-01T00:00:00Z",
      description: "We build a tiny compiler.\n0:00 Intro\n12:30 Parser",
      tags: ["compilers", "rust"],
      durationSeconds: 3900,
      thumbnails: {},
    },
    transcript: {
      language: "en",
      cleanedText:
        "Today we build a compiler from scratch. The parser is just a loop over tokens.",
      segments: [
        {
          startSeconds: 0,
          endSeconds: 8,
          text: "Today we build a compiler from scratch.",
        },
        {
          startSeconds: 750,
          endSeconds: 760,
          text: "The parser is just a loop over tokens.",
        },
      ],
    },
    chapters: [
      { startSeconds: 0, title: "Intro" },
      { startSeconds: 750, title: "Parser" },
    ],
    warnings: [],
    ...overrides,
  };
}

const SUMMARY =
  "[0:08] The host builds a compiler from scratch. [12:30] Parser demo begins.";

describe("buildStructuringPrompt", () => {
  test("embeds the RAW ANALYSIS contract with the video hints", () => {
    const prompt = buildStructuringPrompt(makeEvidence(), SUMMARY, "");
    expect(prompt).toContain("RAW ANALYSIS");
    expect(prompt).toContain("## Full breakdown");
    expect(prompt).toContain("300-1200 words, as long as the video warrants");
    expect(prompt).toContain(
      "chronological breakdown of what the video covers, with rough timestamps for notable moments",
    );
    // Shared contract sections that carry the old structured-analysis fields.
    expect(prompt).toContain("## Overview");
    expect(prompt).toContain("## Key claims & facts");
    expect(prompt).toContain("## Notable quotes");
    expect(prompt).toContain("## Entities");
    expect(prompt).toContain("## Context & metadata");
    // Video-specific extra sections.
    expect(prompt).toContain("## Tools & frameworks");
    expect(prompt).toContain("## Notable moments");
  });

  test("carries no voiced-post or appendix remnants", () => {
    const prompt = buildStructuringPrompt(
      makeEvidence(),
      SUMMARY,
      "some note",
    );
    expect(prompt).not.toContain("first-person");
    expect(prompt).not.toContain("AUTHOR VOICE");
    expect(prompt).not.toContain("<voice>");
    expect(prompt).not.toContain("120-300 words");
    expect(prompt).not.toContain("<details>");
    // Neutral analyst voice comes from the shared contract.
    expect(prompt).toContain("neutral analyst, third person");
  });

  test("includes the video's own metadata and evidence summary", () => {
    const prompt = buildStructuringPrompt(makeEvidence(), SUMMARY, "");
    expect(prompt).toContain("Title: Building a Compiler in a Weekend");
    expect(prompt).toContain("Channel: Systems Garage");
    expect(prompt).toContain("Duration: 1:05:00");
    expect(prompt).toContain(
      "Canonical URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    // Transcript context grounds verbatim quotes.
    expect(prompt).toContain("The parser is just a loop over tokens.");
    expect(prompt).toContain(SUMMARY);
  });

  test("leads with the author's note before the contract and evidence", () => {
    const prompt = buildStructuringPrompt(
      makeEvidence(),
      SUMMARY,
      "watch the parser trick at the end",
    );
    const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
    const contractIdx = prompt.indexOf("RAW ANALYSIS");
    const summaryIdx = prompt.indexOf(SUMMARY);
    expect(noteIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeLessThan(contractIdx);
    expect(contractIdx).toBeLessThan(summaryIdx);
    expect(prompt).toContain("watch the parser trick at the end");
  });

  test("omits the note block when notes are empty", () => {
    const prompt = buildStructuringPrompt(makeEvidence(), SUMMARY, "   ");
    expect(prompt).not.toContain("AUTHOR'S NOTE");
  });

  test("survives missing metadata/transcript (evidence fallback path)", () => {
    const prompt = buildStructuringPrompt(
      makeEvidence({ metadata: null, transcript: null, chapters: [] }),
      SUMMARY,
      "",
    );
    expect(prompt).toContain("RAW ANALYSIS");
    expect(prompt).toContain("(unavailable — rely on video + description)");
    expect(prompt).toContain(SUMMARY);
  });
});
