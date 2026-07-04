// bun test for the pure App Store terms-gate decision (session.ts). Excluded
// from tsc like the other bun:test files in this app. Covers the server-side
// enforcement that a session with no accepted terms cannot create/mutate UGC:
// the UI gate is bypassable via direct API calls, so `agreedOr403` is the choke
// point every UGC mutation route funnels through.
import { describe, expect, test } from "bun:test";
import type { Session } from "@repo/auth";

import { agreedOr403, hasAcceptedTerms } from "./session";

// Minimal Session stub — only `user.termsAcceptedAt` drives the gate. Everything
// else is irrelevant to the decision, so we cast a partial shape.
function sessionWith(termsAcceptedAt: Date | null | undefined): Session {
  return { user: { id: "u1", termsAcceptedAt } } as unknown as Session;
}

describe("hasAcceptedTerms", () => {
  test("null termsAcceptedAt → not accepted", () => {
    expect(hasAcceptedTerms(sessionWith(null))).toBe(false);
  });

  test("undefined termsAcceptedAt → not accepted", () => {
    expect(hasAcceptedTerms(sessionWith(undefined))).toBe(false);
  });

  test("a Date → accepted", () => {
    expect(hasAcceptedTerms(sessionWith(new Date("2026-01-01")))).toBe(true);
  });

  test("epoch Date (falsy-looking but valid) → accepted", () => {
    // Guards against a truthiness check instead of a null check.
    expect(hasAcceptedTerms(sessionWith(new Date(0)))).toBe(true);
  });
});

describe("agreedOr403", () => {
  test("no accepted terms → distinct 403 { error: 'terms-required' }", async () => {
    const res = agreedOr403(sessionWith(null));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual({ error: "terms-required" });
  });

  test("accepted terms → null (handler proceeds)", () => {
    expect(agreedOr403(sessionWith(new Date("2026-01-01")))).toBeNull();
  });
});
