// Document-specific Gemini runner. Two-call pattern mirroring the YouTube
// gatherEvidence → structuringPrompt flow:
//   1. Evidence: extract structured content from the file. PDFs go through a
//      Gemini native-file structured-extraction pass (parsePdfStructure); DOCX
//      go through mammoth's plain-text extraction (parseDocxText).
//   2. Structuring: take that evidence text + author notes and return a strict
//      PostDraftSchema object, forced to type FINDING.
//
// Returns null (or throws) when it can't get usable evidence, so the document
// branch in gemini-runner.ts falls back to the prior direct-Gemini-file path.

import { extname } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getVoiceProfile } from "@repo/db";
import { buildVoiceInstruction } from "@repo/ingest-draft";
import { generateText, Output } from "ai";
import { getAIConfig, getHeavyModel } from "../../lib/ai-config";
import { PostDraftSchema, toGeminiOutput } from "../gemini-runner";
import { notesLeadLines } from "../prompt-blocks";
import type { GeminiOutput, PipelineInput } from "../types";
import { parseDocxText } from "./parse-docx";
import { parsePdfStructure } from "./parse-pdf";

type DocumentInput = Extract<PipelineInput, { kind: "video" | "audio" | "document" }>;

function isPdf(input: DocumentInput): boolean {
  const mime = input.mimeType.toLowerCase();
  if (mime.includes("pdf")) {
    return true;
  }
  return extname(input.stagedFilePath).toLowerCase() === ".pdf";
}

function isDocx(input: DocumentInput): boolean {
  const mime = input.mimeType.toLowerCase();
  if (
    mime.includes(
      "vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
  ) {
    return true;
  }
  return extname(input.stagedFilePath).toLowerCase() === ".docx";
}

function buildStructuringPrompt(
  evidence: string,
  notes: string,
  voiceBlock: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single FINDING post for a personal blog from pre-extracted document content.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "Summarize what the document is, its key claims, and why it's worth noting. Cite any quoted phrases inline naturally.",
    "Also return a one-sentence excerpt summarizing the finding.",
    "Categories: 1-3 broad->narrow slash paths (e.g. 'technology/artificial-intelligence'); reuse common broad top-level fields, don't invent near-duplicates.",
    "",
    ...notesLeadLines(notes),
    "Extracted document content:",
    evidence,
  ];
  if (voiceBlock) {
    lines.push(voiceBlock);
  }
  return lines.join("\n");
}

export async function runDocumentGemini(
  input: PipelineInput,
): Promise<GeminiOutput | null> {
  if (input.kind !== "document") {
    return null;
  }
  const docInput = input;

  const config = getAIConfig();

  // Step 1: extract structured evidence from the file by format.
  let evidence: string;
  if (isPdf(docInput)) {
    const struct = await parsePdfStructure(
      docInput.stagedFilePath,
      config.apiKey,
      config.model,
    );
    evidence = struct.rawText;
  } else if (isDocx(docInput)) {
    evidence = await parseDocxText(docInput.stagedFilePath);
  } else {
    // Unknown document format (e.g. legacy .doc): no dedicated parser, let the
    // caller fall back to the direct-Gemini-file approach.
    return null;
  }

  if (!evidence.trim()) {
    // No usable text extracted — fall back upstream.
    return null;
  }

  // Step 2: structure the evidence into a FINDING draft. Voice resolution uses
  // the same override seam as runGemini (explicit input.voiceProfile wins, else
  // DB fetch) so callers like the gen:try harness can inject voice without a DB.
  const voiceProfile =
    input.voiceProfile ??
    (input.submittedById ? await getVoiceProfile(input.submittedById) : null);
  const voiceBlock = buildVoiceInstruction(voiceProfile);

  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const { output } = await generateText({
    // document draft → heavy (Pro) tier, matching modelForKind("document").
    model: google(getHeavyModel()),
    temperature: config.temperature,
    prompt: buildStructuringPrompt(evidence, docInput.notes, voiceBlock),
    output: Output.object({ schema: PostDraftSchema }),
  });

  return toGeminiOutput(output, "FINDING");
}
