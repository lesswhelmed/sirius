const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Drizzle ships its migrations as `.sql` files that the generated
// `migrations.js` bundle imports directly; `babel-plugin-inline-import`
// (babel.config.js) inlines them, but Metro must first treat `.sql` as a
// source file it will hand to Babel.
if (!config.resolver.sourceExts.includes("sql")) {
  config.resolver.sourceExts.push("sql");
}

// three's exports map serves a different build per import kind (`import` →
// three.module.js, `require` → three.cjs). Our TS/fiber-ESM code imports it
// while fiber's CJS dist requires it, so Metro bundles BOTH builds and the
// second registration logs "THREE.WARNING: Multiple instances of Three.js
// being imported." Pin every bare "three" request to one file so a single
// instance ships. Subpaths (three/*) are left alone.
//
// NOTE: mobile pins three@0.181.0 (not the repo-wide ^0.182) because three
// 0.182.0's GL command stream silently dies on expo-gl — the renderer reports
// draw calls but no pixel ever reaches the screen (verified by version bisect
// on-device: 0.170/0.176/0.180/0.181 render, 0.182 is black). Re-test before
// bumping.
const threeEntry = require.resolve("three"); // → build/three.cjs

// The offline-first SQLite store is native-only. On WEB, expo-sqlite's entry
// pulls in web/worker.ts, which `import`s `./wa-sqlite/wa-sqlite.wasm` — Metro
// can't resolve it (`.wasm` isn't in this project's resolver extensions), so the
// web bundle fails even though iOS/Android are fine. Web here is a static,
// non-product surface (app.json web.output: "static") with no reason to run a
// real on-device DB, so redirect bare `expo-sqlite` to an inert web stub for the
// web platform only. This severs BOTH paths into expo-sqlite on web (our
// @/lib/db/client AND drizzle-orm/expo-sqlite's useLiveQuery) while leaving the
// native bundle's import untouched. See src/lib/db/expo-sqlite-web.ts.
const expoSqliteWebStub = path.resolve(
  projectRoot,
  "src/lib/db/expo-sqlite-web.ts"
);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") {
    return { type: "sourceFile", filePath: threeEntry };
  }
  if (moduleName === "expo-sqlite" && platform === "web") {
    return { type: "sourceFile", filePath: expoSqliteWebStub };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform
  );
};

module.exports = config;
