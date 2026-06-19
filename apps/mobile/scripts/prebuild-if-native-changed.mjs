#!/usr/bin/env node
import { spawnSync } from "node:child_process";
//
// Conditional clean-prebuild for `bun dev`. Runs `expo prebuild --clean` ONLY
// when a native-affecting input changed — deps, app.json/plugins, or the root
// `overrides` (where the llama.rn native pin lives) — or when ios/ is missing.
//
// Why: an unconditional `expo prebuild --clean` wipes ios/ every launch, which
// forces a full `pod install` from scratch every `bun dev` (minutes). When
// nothing native changed, the generated project + Pods are already correct, so
// we skip straight to an incremental `expo run:ios` (seconds; CocoaPods no-ops
// when Podfile.lock is unchanged). When something native DID change, we do the
// full clean rebuild so the binary can never go stale (the original
// "JSI bindings not installed" trap). The verify:native-ai gate still runs
// every dev start regardless.
//
// Fingerprint = sha256 of the manifest inputs that determine the native
// project. Changing a dep, a config plugin, or the llama.rn override edits one
// of these files, so the gate trips exactly when a native regen is needed. A
// purely transitive change with no manifest edit is rare and still caught by
// verify:native-ai + the runtime bridge probe — just not auto-rebuilt.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, ".."); // apps/mobile
const ROOT = join(APP, "..", ".."); // repo root
const CACHE_DIR = join(APP, ".expo"); // gitignored, survives `prebuild --clean`
const CACHE = join(CACHE_DIR, "native-fingerprint.txt");

const INPUTS = [
	join(APP, "package.json"),
	join(APP, "app.json"),
	join(ROOT, "package.json"), // overrides (llama.rn pin) + trustedDependencies
];

function fingerprint() {
	const h = createHash("sha256");
	for (const f of INPUTS) {
		h.update(f);
		h.update("\0");
		h.update(existsSync(f) ? readFileSync(f) : Buffer.from("MISSING"));
		h.update("\0");
	}
	return h.digest("hex");
}

const current = fingerprint();
const cached = existsSync(CACHE) ? readFileSync(CACHE, "utf8").trim() : null;
const iosExists = existsSync(join(APP, "ios"));

if (iosExists && cached === current) {
	console.log(
		"[prebuild-if-native-changed] native inputs unchanged — skipping prebuild (fast incremental run, no pod reinstall)",
	);
	process.exit(0);
}

console.log(
	`[prebuild-if-native-changed] ${
		iosExists ? "native inputs changed" : "no ios/ project"
	} — running expo prebuild --clean…`,
);
const res = spawnSync("npx", ["expo", "prebuild", "--clean"], {
	cwd: APP,
	stdio: "inherit",
});
if (res.status !== 0) {
	// Don't cache on failure — the next `bun dev` must retry the prebuild.
	process.exit(res.status ?? 1);
}
mkdirSync(CACHE_DIR, { recursive: true });
writeFileSync(CACHE, current + "\n");
console.log(
	"[prebuild-if-native-changed] prebuild complete; fingerprint cached",
);
