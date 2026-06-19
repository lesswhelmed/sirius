// Repair bun's incorrect dependency hoisting for the Android native build.
//
// bun sometimes hoists a single version of a transitive dep to the root and lets a package
// that declares an INCOMPATIBLE range resolve that root copy instead of getting its own
// nested one. These mismatches don't surface at install or typecheck — only deep in the
// Android build (gradle shells out to node), as cryptic "node exited 1" failures. This
// guard is idempotent (wired into the root `postinstall`) and, for each known-broken pair,
// vendors a satisfying copy that already exists elsewhere in node_modules into the
// consumer's own node_modules. No network, no version bumps.
//
// Known cases:
//   - expo-modules-autolinking needs commander@^7, but react-native hoists commander@12 to
//     the root → the Android autolinking CLI crashes ("commander.version is not a
//     function") → gradle settings.gradle evaluation fails.
//   - @expo/metro-config needs hermes-parser@^0.33.3, but hermes-parser@0.25 is hoisted to
//     the root → Metro can't parse react-native 0.85's `match (...)` syntax → the
//     :app:createBundleReleaseJsAndAssets task fails.
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NM = join(ROOT, "node_modules");

const FIXES = [
  {
    consumer: "expo-modules-autolinking",
    dep: "commander",
    min: "7.0.0",
    maxExclusive: "8.0.0",
  },
  {
    consumer: "@expo/metro-config",
    dep: "hermes-parser",
    min: "0.33.0",
    maxExclusive: "0.34.0",
  },
];

const nums = (v) => String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const x = nums(a), y = nums(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const inRange = (v, min, maxExclusive) => cmp(v, min) >= 0 && cmp(v, maxExclusive) < 0;
const versionAt = (pkgDir) => {
  try {
    return JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};

// Find a copy of `dep` anywhere under node_modules whose version is in [min, maxExclusive).
const findDonor = (dep, min, maxExclusive) => {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 7 || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === dep) {
        const v = versionAt(join(dir, e.name));
        if (v && inRange(v, min, maxExclusive)) found.push({ dir: join(dir, e.name), v });
      } else if (e.name === "node_modules" || e.name.startsWith("@") || depth < 2) {
        walk(join(dir, e.name), depth + 1);
      }
    }
  };
  walk(NM, 0);
  // Prefer the highest satisfying version.
  return found.sort((a, b) => cmp(b.v, a.v))[0]?.dir ?? null;
};

for (const { consumer, dep, min, maxExclusive } of FIXES) {
  const consumerDir = join(NM, ...consumer.split("/"));
  if (!existsSync(consumerDir)) continue; // package not installed — nothing to fix

  // What version does the consumer currently resolve for `dep`?
  let current = null;
  const req = createRequire(join(consumerDir, "package.json"));
  try {
    current = versionAt(dirname(req.resolve(`${dep}/package.json`)));
  } catch {
    try {
      // Some deps (e.g. commander v12) hide ./package.json behind "exports".
      current = versionAt(dirname(req.resolve(dep)));
    } catch {
      /* unresolved */
    }
  }
  if (current && inRange(current, min, maxExclusive)) continue; // already correct

  const donor = findDonor(dep, min, maxExclusive);
  if (!donor) {
    console.warn(
      `[fix-bun-hoisting] ${consumer} needs ${dep}@[${min},${maxExclusive}) but none found to vendor ` +
        `(has ${current ?? "none"}). Android build may fail.`,
    );
    continue;
  }
  const dest = join(consumerDir, "node_modules", ...dep.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(donor, dest, { recursive: true });
  console.log(
    `[fix-bun-hoisting] vendored ${dep}@${versionAt(donor)} into ${consumer} ` +
      `(was ${current ?? "unresolved"}; from ${donor.replace(ROOT + "/", "")})`,
  );
}
