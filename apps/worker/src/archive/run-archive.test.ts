import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { archiveZipPath, removeZipFile } from "./run-archive";

const noop = () => {};

describe("archiveZipPath", () => {
  test("prefers the stored downloadPath verbatim", () => {
    expect(
      archiveZipPath(
        { id: "abc", userId: "u1", downloadPath: "/data/archives/u1/abc.zip" },
        "/var/archives",
      ),
    ).toBe("/data/archives/u1/abc.zip");
  });

  test("derives ARCHIVES_DIR/userId/id.zip when downloadPath is null", () => {
    // Must mirror the writer: join(resolveArchivesDir(), userId, `${id}.zip`).
    expect(
      archiveZipPath(
        { id: "abc", userId: "u1", downloadPath: null },
        "/var/archives",
      ),
    ).toBe(join("/var/archives", "u1", "abc.zip"));
  });
});

describe("removeZipFile", () => {
  test("deletes an existing zip and reports true", () => {
    const dir = mkdtempSync(join(tmpdir(), "arch-sweep-"));
    const zip = join(dir, "x.zip");
    writeFileSync(zip, "PK");
    expect(existsSync(zip)).toBe(true);

    expect(removeZipFile(zip, noop)).toBe(true);
    expect(existsSync(zip)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("returns false and does not throw for a missing file", () => {
    const missing = join(tmpdir(), `does-not-exist-${Date.now()}.zip`);
    expect(() => removeZipFile(missing, noop)).not.toThrow();
    expect(removeZipFile(missing, noop)).toBe(false);
  });
});
