// Shared, material-agnostic classification signal. Generalizes the shape that
// the Instagram path already computes (see instagram/digest.ts
// ClassificationPrepSchema) so every ingest kind produces the same structure for
// embedding + reverse lookup. Derived deterministically from the Gemini draft —
// no extra LLM call — to keep auto-org cheap and latency-free.
import { z } from "zod";

export const ClassificationPrepSchema = z.object({
  // The dense text actually embedded for similarity. Concrete nouns over
  // adjectives; the primary matching signal.
  retrievalText: z
    .string()
    .describe(
      "Dense paragraph packed with the concrete terms describing this content.",
    ),
  // Lowercase retrieval keywords (from the model's tag output).
  keywords: z
    .array(z.string())
    .describe("Lowercase keywords useful for retrieval."),
  // Candidate analysis/category labels (from the model's category output).
  candidateCategories: z
    .array(z.string())
    .describe(
      "Lowercase kebab-case category candidates, most to least specific.",
    ),
  // Broad field hint used when naming an auto-created Project.
  domainHint: z
    .string()
    .nullable()
    .describe("Broad domain (e.g. 'history', 'technology') or null."),
});

export type ClassificationPrep = z.infer<typeof ClassificationPrepSchema>;

// Max characters of body text folded into retrievalText. gemini-embedding-2
// caps at 8192 tokens; ~4 chars/token, so 4000 chars stays comfortably under.
const MAX_RETRIEVAL_CHARS = 4000;

// Light cleanup so embedded text is concrete prose, not markdown noise: drop
// image markdown, code fences, links-to-bare-text, and collapse whitespace.
export function toPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // image markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/[#>*_`]+/g, " ") // md punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// Build the retrievalText from a title + body (+ optional extra phrases like
// tags/categories/excerpt), truncated to the embed budget.
export function buildRetrievalText(
  title: string,
  body: string,
  extras: string[] = [],
): string {
  const extraLine = extras.filter(Boolean).join(", ");
  const combined = [title, extraLine, toPlainText(body)]
    .filter((s) => s && s.length > 0)
    .join(". ");
  return combined.slice(0, MAX_RETRIEVAL_CHARS);
}
