// Typed errors the safety gate throws so callers can branch:
//   - SafetyFlagError  → content is harmful. TERMINAL, non-retryable. In the
//     worker: quarantine the original, record a ModerationEvent, mark the
//     submission `flagged`, alert the admin, drop the device's optimistic row,
//     NO post. In the web publish/edit gate: refuse to publish (422).
//   - SafetyScanError  → the scan itself could not run (Gemini down/timeout).
//     RETRYABLE / FAIL-CLOSED: the worker re-runs the job; the web gate returns
//     503 and does NOT publish. We never publish UNSCANNED content.
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
