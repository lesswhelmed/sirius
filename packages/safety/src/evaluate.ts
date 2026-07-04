// The pure publish-gate seam. Decides whether a set of scan targets may be
// published, given an INJECTED scan function. Keeping the scan injectable makes
// the whole decision deterministically unit-testable (evaluate.test.ts) without
// hitting Gemini, and lets the web route feed the real scanContent.
//
// FAIL-CLOSED CONTRACT: this never swallows a scan failure. If `scan` rejects
// (classifier unreachable → SafetyScanError), the rejection propagates and the
// caller MUST treat it as "do NOT publish" (the web route returns 503). The only
// outcomes that mean "safe to publish" are decision:"allow".
import { decideSafetyAction } from "./policy";
import type { SafetySeverity, SafetyVerdict } from "./schema";
import type { ScanTarget } from "./targets";

export type PublishDecision =
  | { decision: "allow" }
  | {
      decision: "block";
      action: "flag" | "flag_critical";
      verdict: SafetyVerdict;
    };

export interface EvaluatePublishDeps {
  // Classifier call. In production this is scanContent; in tests it's a stub.
  scan: (targets: ScanTarget[]) => Promise<SafetyVerdict>;
  // Severity threshold at/above which content is blocked (defaults to config's).
  blockSeverity?: SafetySeverity;
}

export async function evaluatePublish(
  targets: ScanTarget[],
  deps: EvaluatePublishDeps,
): Promise<PublishDecision> {
  // Nothing to judge (e.g. every field blank) → allow; there is no user-produced
  // text to gate on.
  if (targets.length === 0) return { decision: "allow" };

  // Deliberately NOT wrapped in try/catch: a scan failure must propagate so the
  // caller fails closed. Only an explicit verdict can produce "allow".
  const verdict = await deps.scan(targets);
  const action = decideSafetyAction(verdict, deps.blockSeverity);
  if (action === "allow") return { decision: "allow" };
  return { decision: "block", action, verdict };
}
