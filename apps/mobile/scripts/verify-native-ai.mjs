#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
//
// verify-native-ai — assert the on-device AI (llama.rn) native module WILL be
// compiled into this build, BEFORE the long prebuild/compile runs.
//
// The JSI bindings that power on-device inference live in the native binary,
// not the JS bundle (see apps/mobile/src/lib/llm/engine.ts). A binary missing
// them throws "JSI bindings not installed" only after a multi-GB model download
// — the worst place to discover it. This script is the build-time guardrail:
//   • EAS runs it as the `eas-build-post-install` hook (after install, before
//     prebuild) so a misconfigured build fails fast in the cloud.
//   • `bun run dev` runs it after `expo prebuild --clean`, before `run:ios`.
//
// Checks are static (resolution + file existence + app.json read), so they are
// fast and independent of the working directory EAS happens to invoke from.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

// Must match the root package.json `overrides` pin and the apps/mobile dep.
// We deliberately run AHEAD of @react-native-ai/llama@0.12's advisory peer
// (^0.10.1): 0.10.x's iOS install() uses raw [RCTBridge currentBridge], which
// is nil under bridgeless New Arch, so the JSI bridge never installs. 0.11.5+
// use self.bridge (the New-Arch interop proxy) and work. A JS/native version
// skew silently breaks the bridge, so drift from the pin is a hard failure.
const EXPECTED_LLAMA_RN = "0.12.4";

function fail(msg) {
	console.error(`\n[verify-native-ai] ✗ ${msg}\n`);
	process.exit(1);
}
function ok(msg) {
	console.log(`[verify-native-ai] ✓ ${msg}`);
}

// 1. The JS packages resolve (else autolinking has nothing to compile).
let llamaPkgPath;
try {
	llamaPkgPath = require.resolve("llama.rn/package.json");
} catch {
	fail(
		"llama.rn is not installed — the on-device AI native module would be absent from the build. Run `bun install`.",
	);
}
const llamaDir = dirname(llamaPkgPath);
const llamaVersion = JSON.parse(readFileSync(llamaPkgPath, "utf8")).version;
if (llamaVersion !== EXPECTED_LLAMA_RN) {
	fail(
		`llama.rn resolved to ${llamaVersion} but ${EXPECTED_LLAMA_RN} is pinned (root overrides + @react-native-ai/llama peer). JS/native version skew breaks the JSI bridge — fix the override/dep.`,
	);
}
ok(`llama.rn ${llamaVersion} installed`);

try {
	require.resolve("@react-native-ai/llama/package.json");
} catch {
	fail("@react-native-ai/llama is not installed — run `bun install`.");
}
ok("@react-native-ai/llama installed");

// 2. The native autolinking artifacts exist, so prebuild compiles RNLlama in.
if (!existsSync(join(llamaDir, "llama-rn.podspec"))) {
	fail(
		"llama.rn is missing its iOS podspec (llama-rn.podspec) — autolinking would skip the native module on iOS.",
	);
}
if (!existsSync(join(llamaDir, "android", "build.gradle"))) {
	fail(
		"llama.rn is missing android/build.gradle — autolinking would skip the native module on Android.",
	);
}
ok("iOS podspec + Android gradle present (will autolink)");

// 2b. The native binaries fetched by llama.rn's postinstall must be present.
//     0.12.x ships them via `install/download-native-artifacts.js` (GitHub
//     release assets), NOT in the npm tarball — bun blocks postinstalls unless
//     the package is in root `trustedDependencies`. A blocked postinstall
//     leaves the podspec's vendored xcframework / Android jniLibs missing, so
//     the module compiles to nothing. This is the check that catches it.
const iosFramework = join(llamaDir, "ios", "rnllama.xcframework");
const androidJniLibs = join(llamaDir, "android", "src", "main", "jniLibs");
const buildFromSource = process.env.RNLLAMA_BUILD_FROM_SOURCE === "1";
if (!buildFromSource && !existsSync(iosFramework)) {
	fail(
		"llama.rn ios/rnllama.xcframework is missing — its postinstall (download-native-artifacts.js) was blocked or failed. Add `llama.rn` to root package.json `trustedDependencies` and reinstall (or set RNLLAMA_BUILD_FROM_SOURCE=1).",
	);
}
if (!existsSync(androidJniLibs)) {
	fail(
		"llama.rn android jniLibs are missing — its postinstall was blocked or failed. Add `llama.rn` to root package.json `trustedDependencies` and reinstall.",
	);
}
ok("native artifacts present (iOS xcframework + Android jniLibs)");

// 3. The config plugin exists AND is referenced, so prebuild applies its native
//    build settings (extended-memory entitlements the 3B models need, etc.).
if (!existsSync(join(llamaDir, "app.plugin.js"))) {
	fail("llama.rn config plugin (app.plugin.js) is missing from the package.");
}
const appJson = JSON.parse(readFileSync(join(HERE, "..", "app.json"), "utf8"));
const plugins = appJson?.expo?.plugins ?? [];
const hasPlugin = plugins.some(
	(p) => p === "llama.rn" || (Array.isArray(p) && p[0] === "llama.rn"),
);
if (!hasPlugin) {
	fail(
		'app.json expo.plugins does not include "llama.rn" — prebuild would not apply its native build settings.',
	);
}
ok("llama.rn config plugin referenced in app.json");

console.log(
	"[verify-native-ai] ✓ on-device AI native module is wired for this build",
);
