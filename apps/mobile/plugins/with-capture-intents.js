const {
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SWIFT_FILES = ["CaptureInSiriusIntent.swift", "SiriusShortcuts.swift"];

// Copy the App Intent Swift sources into the prebuilt iOS app target and
// register them in the Sources build phase. ios/ is gitignored and regenerated
// by `expo prebuild`, so this must run on every prebuild.
const withCaptureIntents = (config) => {
  // (a) Copy sources into ios/<AppName>/
  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } =
        cfg.modRequest;
      const srcDir = path.join(projectRoot, "ios-intents");
      const destDir = path.join(platformProjectRoot, projectName);
      for (const file of SWIFT_FILES) {
        const from = path.join(srcDir, file);
        const to = path.join(destDir, file);
        fs.copyFileSync(from, to);
      }
      return cfg;
    },
  ]);

  // (b) Add the sources to the main target's Sources build phase.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const groupKey =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject().firstProject.mainGroup;
    const target = project.getFirstTarget().uuid;
    for (const file of SWIFT_FILES) {
      const projectPath = `${appName}/${file}`;
      if (!project.hasFile(projectPath)) {
        project.addSourceFile(projectPath, { target }, groupKey);
      }
    }
    return cfg;
  });

  return config;
};

module.exports = withCaptureIntents;
