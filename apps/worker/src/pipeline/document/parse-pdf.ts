// PDF structure extraction. Sends the PDF as a Gemini native `file` content
// part with a structured-extraction prompt, returning the document's title,
// section headings, and a flattened raw text rendering. This evidence feeds the
// second (structuring) call in runDocumentGemini — mirroring the YouTube
// gatherEvidence → structuringPrompt two-call flow. Throwing here lets the
// gemini-runner document branch fall back to the prior direct-Gemini approach.

import { existsSync, readFileSync } from "node:fs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

export const PdfStructureSchema = z.object({
  title: z.string().optional().describe("Document title, if discernible."),
  authors: z
    .array(z.string())
    .default([])
    .describe("Listed authors, if any."),
  date: z
    .string()
    .optional()
    .describe("Publication or document date, if stated."),
  abstract: z
    .string()
    .optional()
    .describe("Abstract or executive summary, if present."),
  sections: z
    .array(z.string())
    .default([])
    .describe("Section headings in document order."),
  keyParagraphs: z
    .array(z.string())
    .default([])
    .describe("The most important paragraphs, verbatim or lightly condensed."),
});

export type PdfStructure = {
  title?: string;
  sections: string[];
  rawText: string;
};

function buildExtractionPrompt(): string {
  return [
    "You are extracting the structure of an attached PDF document so a second model call can draft a short post about it.",
    "Read the whole document. Return:",
    "- title: the document's title",
    "- authors: any listed authors",
    "- date: any stated publication/document date",
    "- abstract: the abstract or an executive summary if present",
    "- sections: the section headings, in document order",
    "- keyParagraphs: the handful of paragraphs that carry the document's core claims, verbatim or lightly condensed.",
    "Do not invent content that is not in the document. If a field is absent, leave it empty.",
  ].join("\n");
}

function renderRawText(struct: z.infer<typeof PdfStructureSchema>): string {
  const lines: string[] = [];
  if (struct.title) {
    lines.push(`Title: ${struct.title}`);
  }
  if (struct.authors.length > 0) {
    lines.push(`Authors: ${struct.authors.join(", ")}`);
  }
  if (struct.date) {
    lines.push(`Date: ${struct.date}`);
  }
  if (struct.abstract) {
    lines.push("", "## Abstract", struct.abstract.trim());
  }
  if (struct.sections.length > 0) {
    lines.push("", "## Sections", ...struct.sections.map((s) => `- ${s}`));
  }
  if (struct.keyParagraphs.length > 0) {
    lines.push("", "## Key paragraphs", ...struct.keyParagraphs);
  }
  return lines.join("\n");
}

export async function parsePdfStructure(
  filePath: string,
  apiKey: string,
  model: string,
): Promise<PdfStructure> {
  if (!existsSync(filePath)) {
    throw new Error(`pdf file not found: ${filePath}`);
  }
  const fileData = readFileSync(filePath);
  const google = createGoogleGenerativeAI({ apiKey });
  const { output } = await generateText({
    model: google(model),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: buildExtractionPrompt() },
          {
            type: "file" as const,
            data: fileData,
            mediaType: "application/pdf" as const,
          },
        ],
      },
    ],
    output: Output.object({ schema: PdfStructureSchema }),
  });
  return {
    title: output.title?.trim() || undefined,
    sections: output.sections,
    rawText: renderRawText(output),
  };
}
