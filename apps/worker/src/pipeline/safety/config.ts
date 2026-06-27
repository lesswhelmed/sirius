// Safety-gate config — one surface for every SAFETY_* env var, mirroring the
// shape of ../lib/ai-config.ts. All knobs have safe defaults so the gate works
// out of the box; everything is env-overridable for tuning per environment.
import type { SafetySeverity } from "./schema";

// Cheap, fast classifier model. Google recommends a Flash-Lite-class model for
// input guardrails. Stable id, env-overridable (verify against the live model
// list if it ever 404s). The classifier reads the content; it does NOT draft.
const DEFAULT_SAFETY_MODEL = "gemini-2.5-flash-lite";
// Block at this severity AND above. `medium` = Google's recommended moderate
// starting threshold. child_safety is always critical regardless (policy.ts).
const DEFAULT_BLOCK_SEVERITY: SafetySeverity = "medium";
const DEFAULT_ALERT_EMAIL = "saleebmina@copt.dev";
// Cap on a fetched PDF so a hostile/huge link can't exhaust memory. 25 MB.
const DEFAULT_MAX_PDF_BYTES = 25 * 1024 * 1024;
// Retries for a transient scan failure before giving up (→ SafetyScanError,
// retryable). Low temperature classification is deterministic enough.
const DEFAULT_SCAN_RETRIES = 2;

export type SafetyConfig = {
  enabled: boolean;
  model: string;
  blockSeverity: SafetySeverity;
  alertEmail: string;
  maxPdfBytes: number;
  scanRetries: number;
};

function isSeverity(v: string): v is SafetySeverity {
  return ["none", "low", "medium", "high", "critical"].includes(v);
}

export function getSafetyConfig(): SafetyConfig {
  const sev = (process.env.SAFETY_BLOCK_SEVERITY ?? "").trim().toLowerCase();
  const maxPdf = Number(process.env.SAFETY_MAX_PDF_BYTES);
  const retries = Number(process.env.SAFETY_SCAN_RETRIES);
  return {
    // Master kill switch. Default ON; set SAFETY_SCAN_ENABLED=false to bypass
    // (e.g. an emergency where Gemini moderation is misbehaving in prod).
    enabled: process.env.SAFETY_SCAN_ENABLED !== "false",
    model: process.env.SAFETY_MODEL ?? DEFAULT_SAFETY_MODEL,
    blockSeverity: isSeverity(sev) ? sev : DEFAULT_BLOCK_SEVERITY,
    alertEmail: process.env.SAFETY_ALERT_EMAIL ?? DEFAULT_ALERT_EMAIL,
    maxPdfBytes: Number.isFinite(maxPdf) && maxPdf > 0 ? maxPdf : DEFAULT_MAX_PDF_BYTES,
    scanRetries: Number.isInteger(retries) && retries >= 0 ? retries : DEFAULT_SCAN_RETRIES,
  };
}

export { DEFAULT_SAFETY_MODEL, DEFAULT_BLOCK_SEVERITY, DEFAULT_ALERT_EMAIL };
