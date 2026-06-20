// DOCX plain-text extraction via mammoth. mammoth.extractRawText pulls the
// document body as plain text (no styling), which then feeds the structuring
// prompt in runDocumentGemini. On any failure we return "" so the document
// branch in gemini-runner falls back to the prior direct-Gemini-file approach
// rather than failing the submission — DOCX previously failed outright because
// Gemini does not natively read the OOXML container.

import mammoth from "mammoth";

export async function parseDocxText(filePath: string): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value.trim();
  } catch (error) {
    console.warn(
      `[document] mammoth DOCX extraction failed, falling back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return "";
  }
}
