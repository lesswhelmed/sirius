// Typed errors the safety gate throws so the worker's catch can branch:
//   - SafetyFlagError  → content is harmful. TERMINAL, non-retryable: quarantine
//     the original, record a ModerationEvent, mark the submission `flagged`,
//     alert the admin, signal the device to drop its optimistic row. NO post.
//   - SafetyScanError  → the scan itself could not run (Gemini down/timeout).
//     RETRYABLE (fail-closed): falls through to the normal markFailed path so the
//     reclaimer re-runs it; we never publish UNSCANNED content.
import type { SafetyVerdict } from "./schema";

export type SafetyAction = "allow" | "flag" | "flag_critical";

export class SafetyFlagError extends Error {
  readonly verdict: SafetyVerdict;
  readonly action: Exclude<SafetyAction, "allow">;
  constructor(verdict: SafetyVerdict, action: Exclude<SafetyAction, "allow">) {
    super(
      `content flagged: ${action} [${verdict.severity}] ${verdict.categories.join(",") || "uncategorized"}`,
    );
    this.name = "SafetyFlagError";
    this.verdict = verdict;
    this.action = action;
  }
}

export class SafetyScanError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(`safety scan failed: ${message}`);
    this.name = "SafetyScanError";
    this.cause = cause;
  }
}
