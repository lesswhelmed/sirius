import { expect, test } from "bun:test";
import { PostSearchInputSchema } from "./schema";

test("includeFriends defaults to false when omitted", () => {
  const parsed = PostSearchInputSchema.parse({ query: "climbing trips" });
  expect(parsed.includeFriends).toBe(false);
});

test("includeFriends is accepted when the model sets it", () => {
  const parsed = PostSearchInputSchema.parse({
    query: "what did my friends post about coffee",
    includeFriends: true,
  });
  expect(parsed.includeFriends).toBe(true);
});
