// Run with: bun test src/lib/upload-progress.test.ts  (from apps/mobile)
import { describe, expect, test } from "bun:test";

import {
  clearProgress,
  emitProgress,
  getProgress,
  subscribe,
} from "./upload-progress";

describe("upload-progress emitter", () => {
  test("emit then get returns the latest snapshot", () => {
    emitProgress("row1", { pct: 42, sent: 42, total: 100 });
    expect(getProgress("row1")).toEqual({ pct: 42, sent: 42, total: 100 });
  });

  test("subscribers receive emitted snapshots until unsubscribed", () => {
    const seen: number[] = [];
    const off = subscribe("row2", (s) => seen.push(s.pct));
    emitProgress("row2", { pct: 10, sent: 10, total: 100 });
    emitProgress("row2", { pct: 20, sent: 20, total: 100 });
    off();
    emitProgress("row2", { pct: 30, sent: 30, total: 100 });
    expect(seen).toEqual([10, 20]);
  });

  test("clearProgress removes stored state", () => {
    emitProgress("row3", { pct: 99, sent: 99, total: 100 });
    clearProgress("row3");
    expect(getProgress("row3")).toBeUndefined();
  });
});
