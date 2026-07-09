// Raw-analysis bodies are structured markdown (## sections, tables, quotes).
// escapeMdxProse must leave that structure intact while still neutralizing the
// MDX hazards (stray < and {) it exists for.
import { expect, test } from "bun:test";
import { escapeMdxProse } from "./mdx-escape";

test("headings, tables, and blockquotes pass through untouched", () => {
  const body = [
    "## Overview",
    "A thing.",
    "",
    "## Data & numbers",
    "| metric | value |",
    "| --- | --- |",
    "| price | $12 |",
    "",
    "> a verbatim quote",
  ].join("\n");
  expect(escapeMdxProse(body)).toBe(body);
});

test("stray < and { still escape inside analysis prose", () => {
  const body = "## Key claims & facts\nLatency <100ms at {scale}.";
  const out = escapeMdxProse(body);
  expect(out).toContain("&lt;100ms");
  expect(out).toContain("\\{scale}");
  expect(out).toContain("## Key claims & facts");
});
