// Run with: bun test src/lib/progress-throttle.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import { coarseMilestone, shouldPersist } from "./progress-throttle";

describe("shouldPersist", () => {
  test("first progress (prevAtMs 0) always persists", () => {
    expect(shouldPersist(0, 1, 0, 500)).toBe(true);
  });
  test("tiny delta within the time window does NOT persist", () => {
    expect(shouldPersist(40, 42, 1_000, 1_200)).toBe(false);
  });
  test(">=5% delta persists even inside the time window", () => {
    expect(shouldPersist(40, 45, 1_000, 1_100)).toBe(true);
  });
  test(">=500ms elapsed persists even on a tiny delta", () => {
    expect(shouldPersist(40, 41, 1_000, 1_600)).toBe(true);
  });
  test("reaching 100 always persists (terminal)", () => {
    expect(shouldPersist(97, 100, 1_000, 1_050)).toBe(true);
  });
});

describe("coarseMilestone", () => {
  test("buckets to 0/25/50/75/100", () => {
    expect(coarseMilestone(0)).toBe(0);
    expect(coarseMilestone(24)).toBe(0);
    expect(coarseMilestone(25)).toBe(25);
    expect(coarseMilestone(60)).toBe(50);
    expect(coarseMilestone(88)).toBe(75);
    expect(coarseMilestone(100)).toBe(100);
  });
});
