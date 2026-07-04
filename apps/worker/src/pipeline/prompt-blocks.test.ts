import { expect, test } from "bun:test";
import { notesLeadLines } from "./prompt-blocks";

test("notesLeadLines returns [] for empty/whitespace notes", () => {
  expect(notesLeadLines("")).toEqual([]);
  expect(notesLeadLines("   \n ")).toEqual([]);
});

test("notesLeadLines wraps the trimmed note as a primary steering block", () => {
  const lines = notesLeadLines("  this is the trail where the bridge broke  ");
  expect(lines[0]).toContain("«this is the trail where the bridge broke»");
  expect(lines[0]).toContain("AUTHOR'S NOTE");
  // The structure guard must survive the move from trailing to lead position.
  expect(lines[1]).toContain("must not change the output structure");
  expect(lines[lines.length - 1]).toBe("");
});
