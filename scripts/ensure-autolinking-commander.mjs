// Ensure expo-modules-autolinking has a compatible nested `commander` (v7).
//
// Why: `react-native` depends on commander ^12, which bun hoists to the root
// node_modules. `expo-modules-autolinking@56` depends on commander ^7 and uses the
// v7-style `commander.version(...)` global-program API. bun sometimes fails to give
// expo-modules-autolinking its own nested copy, so its CLI resolves the root v12 and
// crashes with `commander_1.default.version is not a function` — which surfaces only at
// Android build time as a cryptic gradle failure (settings.gradle autolinking step:
// "Process 'command 'node'' finished with non-zero exit value 1").
//
// This guard is idempotent and safe to run on every install (wired into the root
// `postinstall`). If the version expo-modules-autolinking resolves is already v7 it does
// nothing; otherwise it copies a v7 copy that already exists elsewhere in the tree into
// node_modules/expo-modules-autolinking/node_modules/commander.
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const AUTOLINK = join(ROOT, "node_modules", "expo-modules-autolinking");
if (!existsSync(AUTOLINK)) process.exit(0); // not an RN/Expo install — nothing to do

const majorOf = (pkgJsonPath) => {
  try {
    return parseInt(JSON.parse(readFileSync(pkgJsonPath, "utf8")).version, 10);
  } catch {
    return NaN;
  }
};

// What commander does expo-modules-autolinking actually resolve right now?
const reqFromAutolink = createRequire(join(AUTOLINK, "package.json"));
let resolvedMajor = NaN;
try {
  resolvedMajor = majorOf(reqFromAutolink.resolve("commander/package.json"));
} catch {
  // commander v12 hides ./package.json behind "exports"; fall back to the module dir.
  try {
    const entry = reqFromAutolink.resolve("commander");
    resolvedMajor = majorOf(join(dirname(entry), "package.json"));
  } catch {
    /* unresolved — treat as missing */
  }
}

if (resolvedMajor === 7) process.exit(0); // already correct

// Find any commander@7.x already on disk to copy (avoids a network install).
const findV7 = () => {
  const candidates = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "commander") {
        const pj = join(dir, e.name, "package.json");
        if (majorOf(pj) === 7) candidates.push(join(dir, e.name));
      } else if (e.name === "node_modules" || e.name.startsWith("@") || depth < 2) {
        walk(join(dir, e.name), depth + 1);
      }
    }
  };
  walk(join(ROOT, "node_modules"), 0);
  return candidates[0];
};

const src = findV7();
if (!src) {
  console.warn(
    "[ensure-autolinking-commander] no commander@7 found in node_modules to vendor; " +
      "Android autolinking may fail. Run: bun add --cwd node_modules/expo-modules-autolinking commander@^7.2.0",
  );
  process.exit(0);
}

const dest = join(AUTOLINK, "node_modules", "commander");
mkdirSync(join(AUTOLINK, "node_modules"), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[ensure-autolinking-commander] vendored commander@7 into expo-modules-autolinking (from ${src.replace(ROOT + "/", "")})`);
