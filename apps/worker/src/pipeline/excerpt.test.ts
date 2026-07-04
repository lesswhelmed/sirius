import { expect, test } from "bun:test";
import { firstSentenceExcerpt } from "./excerpt";

test("takes the first sentence of plain prose", () => {
  expect(
    firstSentenceExcerpt("I walked the trail today. It was muddy."),
  ).toBe("I walked the trail today.");
});

test("skips the worker's Source: line and embeds", () => {
  const body =
    "Source: https://example.com\n\nThe article argues X. More detail.\n";
  expect(firstSentenceExcerpt(body)).toBe("The article argues X.");
  const yt = `<YouTubeEmbed url="https://youtu.be/abc" />\n\nGreat video about Y. And more.\n`;
  expect(firstSentenceExcerpt(yt)).toBe("Great video about Y.");
});

test("skips headings, dividers, image markdown, and blockquotes", () => {
  const body = "# Title\n\n---\n\n![alt](/x.png)\n\n> quoted\n\nReal prose here. Next.";
  expect(firstSentenceExcerpt(body)).toBe("Real prose here.");
});

test("never reads into the OCR extracted-text section", () => {
  const body = "---\n\n**Extracted text:**\n\nSIGN TEXT FROM PHOTO";
  expect(firstSentenceExcerpt(body)).toBeNull();
});

test("clamps to 200 chars", () => {
  const long = `${"word ".repeat(80)}end.`;
  expect(firstSentenceExcerpt(long)?.length).toBe(200);
});

test("returns null for empty input", () => {
  expect(firstSentenceExcerpt("")).toBeNull();
  expect(firstSentenceExcerpt("\n\n")).toBeNull();
});
