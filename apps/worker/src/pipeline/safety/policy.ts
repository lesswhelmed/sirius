// Pure verdict → action decision. No I/O, no env reads beyond the injected
// threshold — kept side-effect-free so it's exhaustively unit-testable
// (policy.test.ts). The worker calls decideSafetyAction(verdict) with the
// configured block severity; everything else here is a pure mapping.
import type { SafetyAction } from "./errors";
import type { SafetySeverity, SafetyVerdict } from "./schema";
import { SAFETY_SEVERITY_RANK } from "./schema";
import { DEFAULT_BLOCK_SEVERITY } from "./config";

// Categories that are ALWAYS critical regardless of the model's own severity
// read. Child-safety content is never "medium" to us — any signal is a CRITICAL
// flag with the strictest downstream protocol. (Google's non-configurable filter
// also blocks CSAM at the model layer; this is our belt-and-suspenders.)
const ALWAYS_CRITICAL_CATEGORIES = new Set<string>(["child_safety"]);

export function decideSafetyAction(
  verdict: SafetyVerdict,
  blockSeverity: SafetySeverity = DEFAULT_BLOCK_SEVERITY,
): SafetyAction {
  // 1. Any child-safety signal → critical, no matter what else the model said.
  if (verdict.categories.some((c) => ALWAYS_CRITICAL_CATEGORIES.has(c))) {
    return "flag_critical";
  }
  // 2. Model-declared critical severity → critical.
  if (verdict.severity === "critical") {
    return "flag_critical";
  }
  // 3. At/above the configured block threshold → flag.
  if (SAFETY_SEVERITY_RANK[verdict.severity] >= SAFETY_SEVERITY_RANK[blockSeverity]) {
    return "flag";
  }
  // 4. Below threshold → allow (the `safe` boolean is advisory only; severity is
  //    the gate, so a "safe:false, severity:low" stays allowed by design).
  return "allow";
}

// A synthetic verdict for the case where Gemini's OWN non-configurable safety
// filter blocks the classifier call (finishReason content-filter) even though we
// requested BLOCK_NONE. That block is itself a strong harm signal — most often
// child-safety — so we treat it as the strictest tier rather than letting it
// fall through as a scan error.
export function providerBlockedVerdict(detail: string): SafetyVerdict {
  return {
    safe: false,
    severity: "critical",
    categories: ["child_safety"],
    rationale: `provider safety filter blocked the classifier: ${detail}`.slice(0, 600),
  };
}
