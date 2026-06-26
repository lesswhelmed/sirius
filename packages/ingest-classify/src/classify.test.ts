// Regression suite for the host-agnostic id generation (newId).
//
// The omni-ingest refactor reached for `globalThis.crypto.randomUUID()`, which
// is present in browsers + Bun/Node but UNDEFINED in the mobile RN/Hermes
// runtime this app ships. Typing a note in the Capture tab therefore crashed
// with "Cannot read property 'randomUUID' of undefined". These tests simulate
// the Hermes environment (no global `crypto`) so we can prove the fix off-device
// before confirming on the simulator with agent-device.

import { afterEach, describe, expect, test } from "bun:test";

import { classifyInput, classifyText } from "./classify";

const realCrypto = globalThis.crypto;

afterEach(() => {
  // Restore whatever the runtime really had between cases.
  Object.defineProperty(globalThis, "crypto", {
    value: realCrypto,
    configurable: true,
    writable: true,
  });
});

function simulateHermesNoCrypto() {
  // Hermes (this app's RN engine) has no global `crypto` object at all.
  Object.defineProperty(globalThis, "crypto", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("newId is host-agnostic (mobile Hermes has no global crypto)", () => {
  test("classifyText('note') does not throw when globalThis.crypto is undefined", () => {
    simulateHermesNoCrypto();

    // This is the exact path the Capture tab hits when a note is added to the
    // tray: classifyText -> makeNoteItem -> newId. Before the fix this threw
    // "Cannot read property 'randomUUID' of undefined".
    const result = classifyText("just a quick note");

    expect(result.items).toHaveLength(1);
    const note = result.items[0]!;
    expect(note.kind).toBe("note");
    expect(note.content).toBe("just a quick note");
    expect(typeof note.id).toBe("string");
    expect(note.id.length).toBeGreaterThan(0);
  });

  test("generated ids are unique and valid UUIDv4 without global crypto", () => {
    simulateHermesNoCrypto();

    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const note = classifyInput(`note number ${i}`)[0]!;
      expect(note.id).toMatch(UUID_RE);
      ids.add(note.id);
    }
    // No collisions across 500 generations.
    expect(ids.size).toBe(500);
  });

  test("still works normally when global crypto IS present (web/worker host)", () => {
    // Don't touch globalThis.crypto — use whatever Bun provides (it has it).
    const note = classifyText("note on a crypto-capable host").items[0]!;
    expect(note.kind).toBe("note");
    expect(note.id).toMatch(UUID_RE);
  });
});
