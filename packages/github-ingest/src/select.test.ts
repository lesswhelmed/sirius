import { describe, expect, test } from "bun:test";

import { slugifyTree } from "./__fixtures__/slugify";
import { type GitTreeEntry, selectKeyFiles } from "./select";

const realTree: GitTreeEntry[] = slugifyTree.tree.map((e) => ({
	path: e.path,
	type: e.type as GitTreeEntry["type"],
	size: (e as { size?: number }).size,
}));

describe("selectKeyFiles — real slugify tree", () => {
	const { readmePath, keyFilePaths } = selectKeyFiles(realTree, 8);

	test("detects the lowercase top-level readme", () => {
		expect(readmePath).toBe("readme.md");
	});

	test("selects the manifest then the root entry point, in that order", () => {
		expect(keyFilePaths).toEqual(["package.json", "index.js"]);
	});

	test("never includes the README among key files", () => {
		expect(keyFilePaths).not.toContain("readme.md");
	});

	test("skips non-entry root scripts and nested non-docs", () => {
		expect(keyFilePaths).not.toContain("overridable-replacements.js");
		expect(keyFilePaths).not.toContain("test.js");
		expect(keyFilePaths).not.toContain("index.d.ts"); // not a real entry ext
		expect(keyFilePaths).not.toContain(".github/security.md");
	});
});

describe("selectKeyFiles — synthetic edge cases", () => {
	test("priority order manifest < entry < arch-doc < docs/, and caps", () => {
		const tree: GitTreeEntry[] = [
			{ path: "docs/usage.md", type: "blob", size: 100 },
			{ path: "ARCHITECTURE.md", type: "blob", size: 100 },
			{ path: "src/index.ts", type: "blob", size: 100 },
			{ path: "package.json", type: "blob", size: 100 },
		];
		const { keyFilePaths } = selectKeyFiles(tree, 8);
		expect(keyFilePaths).toEqual([
			"package.json",
			"src/index.ts",
			"ARCHITECTURE.md",
			"docs/usage.md",
		]);
		// maxFiles cap keeps only the top-priority entries.
		expect(selectKeyFiles(tree, 2).keyFilePaths).toEqual([
			"package.json",
			"src/index.ts",
		]);
	});

	test("skips oversized, vendored, and non-blob entries", () => {
		const tree: GitTreeEntry[] = [
			{ path: "package.json", type: "blob", size: 200_000 }, // oversized lockfile-like
			{ path: "node_modules/x/index.js", type: "blob", size: 100 }, // vendored
			{ path: "src", type: "tree" }, // directory
			{ path: "go.mod", type: "blob", size: 50 }, // real manifest, kept
		];
		const { keyFilePaths } = selectKeyFiles(tree, 8);
		expect(keyFilePaths).toEqual(["go.mod"]);
	});

	test("prefers a top-level README over a nested one", () => {
		const tree: GitTreeEntry[] = [
			{ path: "packages/x/README.md", type: "blob", size: 100 },
			{ path: "README.md", type: "blob", size: 100 },
		];
		expect(selectKeyFiles(tree, 8).readmePath).toBe("README.md");
	});
});
