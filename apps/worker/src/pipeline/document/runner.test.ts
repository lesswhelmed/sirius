import { describe, expect, test } from "bun:test";

import { buildStructuringPrompt } from "./runner";

const evidence =
  "1. Introduction\nThe study finds a 42% reduction.\n\n2. Methods\nDouble-blind trial, n=300.";

describe("buildStructuringPrompt", () => {
  const prompt = buildStructuringPrompt(evidence, "grabbed for the methods section");

  test("frames the body as a RAW ANALYSIS of a document", () => {
    expect(prompt).toContain("RAW ANALYSIS");
    expect(prompt).toContain("a document (from the parsed content below)");
    expect(prompt).toContain("300-1200 words, as long as the document warrants");
  });

  test("carries the shared contract sections plus the document extras", () => {
    expect(prompt).toContain("## Full breakdown");
    expect(prompt).toContain(
      "section-by-section: the document's structure, key claims and their evidence, methodology, tables/figures and what they show, notable passages.",
    );
    expect(prompt).toContain(
      "## Extracted text — verbatim passages that carry the substance of the document.",
    );
    expect(prompt).toContain("## Open questions");
  });

  test("never asks for the author's voice", () => {
    expect(prompt).not.toContain("first-person");
    expect(prompt).not.toContain("AUTHOR VOICE");
    expect(prompt.toLowerCase()).toContain("neutral analyst");
  });

  test("embeds the extracted evidence and a grounding line", () => {
    expect(prompt).toContain("Extracted document content:");
    expect(prompt).toContain("The study finds a 42% reduction.");
    expect(prompt).toContain(
      "Ground every claim in the extracted document content below",
    );
  });

  test("leads with the author's note, before the contract and the evidence", () => {
    const noteIdx = prompt.indexOf("AUTHOR'S NOTE");
    expect(noteIdx).toBeGreaterThan(-1);
    expect(prompt).toContain("grabbed for the methods section");
    expect(noteIdx).toBeLessThan(prompt.indexOf("RAW ANALYSIS"));
    expect(noteIdx).toBeLessThan(prompt.indexOf("Extracted document content:"));
  });

  test("omits the note block entirely when notes are blank", () => {
    const noNotes = buildStructuringPrompt(evidence, "  ");
    expect(noNotes).not.toContain("AUTHOR'S NOTE");
    expect(noNotes).toContain("RAW ANALYSIS");
  });
});
