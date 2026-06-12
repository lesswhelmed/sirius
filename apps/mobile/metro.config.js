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
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") {
    return { type: "sourceFile", filePath: threeEntry };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform
  );
};

module.exports = config;
