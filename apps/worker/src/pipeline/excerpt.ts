// Fallback excerpt derivation: the first sentence of the first real prose line
// of a post body, clamped to 200 chars. Used by post-writer when the model
// didn't supply an excerpt (so NO post is created excerpt-null — the field
// carries weight C in searchVector and feeds catalog cards, search snippets,
// and cover-image prompts) and by the one-time backfill script for old rows.
//
// Skips the non-prose lines the worker wraps around the drafted text:
// "Source: <url>" lines, JSX embeds (<YouTubeEmbed .../>), markdown headings,
// dividers, image markdown, blockquotes — and never reads past the OCR
// "**Extracted text:**" section (that's sign/scan text, not a summary).
export function firstSentenceExcerpt(markdown: string): string | null {
  const proseOnly = markdown.split("**Extracted text:**")[0] ?? markdown;
  for (const rawLine of proseOnly.split("\n")) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("Source:") ||
      line.startsWith("<") ||
      line.startsWith("#") ||
      line.startsWith("---") ||
      line.startsWith("![") ||
      line.startsWith(">")
    ) {
      continue;
    }
    const sentence = line.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (sentence) {
      return sentence.slice(0, 200);
    }
  }
  return null;
}
