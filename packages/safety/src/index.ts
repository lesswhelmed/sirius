// Public surface of the shared content-safety classifier. This package is the
// single source of truth for the harm taxonomy, the classifier prompt/schema,
// the verdict→action policy, and the Gemini scan call — consumed by the web
// publish/edit gate (apps/web PATCH /api/app/posts/[slug]) today.
//
// FOLLOW-UP: the worker's apps/worker/src/pipeline/safety/* still carries its own
// copy of this core (schema/prompt/config/errors/policy/scan). Converging it onto
// @repo/safety (replace those 6 files with re-exports, keep the worker-only
// target-building/quarantine/alert in place) removes the duplication — deferred
// here to avoid editing many files in the running worker daemon.
export { getSafetyConfig } from "./config";
export type { SafetyConfig } from "./config";
export { DEFAULT_BLOCK_SEVERITY, DEFAULT_ALERT_EMAIL } from "./config";
export { SafetyFlagError, SafetyScanError } from "./errors";
export type { SafetyAction } from "./errors";
export { decideSafetyAction, providerBlockedVerdict } from "./policy";
export { scanContent } from "./scan";
export { evaluatePublish } from "./evaluate";
export type { PublishDecision, EvaluatePublishDeps } from "./evaluate";
export { buildTextScanTargets } from "./targets";
export type { ScanTarget } from "./targets";
export {
  SAFETY_SYSTEM_PROMPT,
  buildScanInstruction,
  wrapUserText,
} from "./prompt";
export {
  SafetyVerdictSchema,
  SAFETY_CATEGORIES,
  SAFETY_SEVERITIES,
  SAFETY_SEVERITY_RANK,
} from "./schema";
export type {
  SafetyVerdict,
  SafetyCategory,
  SafetySeverity,
} from "./schema";
