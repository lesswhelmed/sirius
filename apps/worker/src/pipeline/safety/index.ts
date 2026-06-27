// Public surface of the content-safety gate. The pipeline calls runSafetyGate()
// as a distinct stage BEFORE any drafting/quota work; the worker's catch branches
// on the typed errors re-exported here. Everything else is decoupled internals.
import type { PipelineInput } from "../types";
import { getSafetyConfig } from "./config";
import { SafetyFlagError } from "./errors";
import { decideSafetyAction } from "./policy";
import { scanContent } from "./scan";
import { collectScanTargets, shouldScan } from "./targets";

type StageLog = (stage: string, extra?: Record<string, unknown>) => void;

// Runs the gate. Returns normally when the content is allowed (or out of scope /
// the gate is disabled). Throws:
//   - SafetyFlagError  on a harmful verdict (terminal, worker quarantines + flags)
//   - SafetyScanError  when the scan itself couldn't run (retryable, fail-closed)
export async function runSafetyGate(
  input: PipelineInput,
  logger?: StageLog,
): Promise<void> {
  const cfg = getSafetyConfig();
  if (!cfg.enabled) {
    logger?.("safety:disabled");
    return;
  }
  if (!shouldScan(input)) {
    logger?.("safety:skip", { kind: input.kind, reason: "out-of-scope" });
    return;
  }
  const targets = await collectScanTargets(input, cfg);
  if (targets.length === 0) {
    logger?.("safety:skip", { kind: input.kind, reason: "no-targets" });
    return;
  }
  const verdict = await scanContent(targets, { logger });
  const action = decideSafetyAction(verdict, cfg.blockSeverity);
  if (action !== "allow") {
    throw new SafetyFlagError(verdict, action);
  }
  logger?.("safety:pass", {
    severity: verdict.severity,
    categories: verdict.categories,
  });
}

export { getSafetyConfig } from "./config";
export { SafetyFlagError, SafetyScanError } from "./errors";
export type { SafetyAction } from "./errors";
export { decideSafetyAction, providerBlockedVerdict } from "./policy";
export { quarantineOriginal, resolveQuarantineDir } from "./quarantine";
export { sendSafetyAlert } from "./alert";
export { shouldScan, collectScanTargets } from "./targets";
export { scanContent } from "./scan";
export type { SafetyVerdict, SafetyCategory, SafetySeverity } from "./schema";
export { SAFETY_CATEGORIES } from "./schema";
