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
import { generateText, Output } from "ai";
import { getAIConfig, getHeavyModel } from "../../lib/ai-config";
import { analysisContractLines } from "../analysis-contract";
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

// Exported for unit testing — the prompt is this runner's one durable, pure
// transformation of the evidence (the generateText call around it isn't unit
// testable without a live model). Body follows the shared RAW-ANALYSIS
// contract (../analysis-contract.ts); the author's voiceProfile deliberately
// no longer touches body prompts.
export function buildStructuringPrompt(evidence: string, notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Today's date: ${today}.`,
    "",
    ...notesLeadLines(notes),
    ...analysisContractLines({
      kindLabel: "a document (from the parsed content below)",
      lengthHint: "300-1200 words, as long as the document warrants",
      breakdownHint:
        "section-by-section: the document's structure, key claims and their evidence, methodology, tables/figures and what they show, notable passages.",
      extraSections: [
        "## Extracted text — verbatim passages that carry the substance of the document.",
      ],
    }),
    "Ground every claim in the extracted document content below — do not invent material the document does not contain.",
    "",
    "Extracted document content:",
    evidence,
  ];
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

  // Step 2: structure the evidence into a FINDING raw analysis (neutral analyst
  // voice per the shared contract — no author voiceProfile in body prompts).
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const { output } = await generateText({
    // document draft → heavy (Pro) tier, matching modelForKind("document").
    model: google(getHeavyModel()),
    temperature: config.temperature,
    prompt: buildStructuringPrompt(evidence, docInput.notes),
    output: Output.object({ schema: PostDraftSchema }),
  });

  return toGeminiOutput(output, "FINDING");
}
