// The guardrail call. A dedicated, cheap Gemini classification request — fully
// decoupled from drafting — that reads the user's material and returns a
// structured SafetyVerdict. Mirrors gemini-runner's AI-SDK usage
// (createGoogleGenerativeAI + generateText + Output.object).
//
// IMPORTANT: the classifier sets safetySettings to BLOCK_NONE on the CONFIGURABLE
// categories. We WANT the classifier to read and judge harmful content — turning
// the filters on would make Gemini refuse exactly the material we need it to
// classify. CSAM is still blocked by Google's NON-configurable filter regardless;
// if that trips (finishReason content-filter), we treat it as a critical signal
// rather than a scan failure (providerBlockedVerdict). The DRAFT call keeps
// filters ON as defense-in-depth — see gemini-runner.ts.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { requireApiKey } from "../../lib/ai-config";
import { getSafetyConfig } from "./config";
import { SafetyScanError } from "./errors";
import { providerBlockedVerdict } from "./policy";
import { buildScanInstruction, SAFETY_SYSTEM_PROMPT, wrapUserText } from "./prompt";
import { SafetyVerdictSchema, type SafetyVerdict } from "./schema";
import type { ScanTarget } from "./targets";

type StageLog = (stage: string, extra?: Record<string, unknown>) => void;

// All configurable harm categories set to BLOCK_NONE so the classifier can see
// the content. (CSAM/child-safety remains non-configurably blocked by Google.)
const CLASSIFIER_SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

function looksLikeProviderBlock(value: unknown): boolean {
  const s = (value instanceof Error ? value.message : String(value)).toUpperCase();
  return (
    s.includes("CONTENT-FILTER") ||
    s.includes("CONTENT_FILTER") ||
    s.includes("SAFETY") ||
    s.includes("PROHIBITED") ||
    s.includes("BLOCKED")
  );
}

function toContentParts(targets: ScanTarget[]) {
  const textBlocks: string[] = [];
  const mediaParts: Array<
    | { type: "image"; image: Buffer; mediaType: string }
    | { type: "file"; data: Buffer; mediaType: `${string}/${string}` }
  > = [];
  for (const t of targets) {
    if (t.kind === "text") {
      textBlocks.push(wrapUserText(t.label, t.text));
    } else if (t.kind === "image") {
      mediaParts.push({ type: "image", image: t.data, mediaType: t.mediaType });
    } else {
      mediaParts.push({
        type: "file",
        data: t.data,
        mediaType: t.mediaType as `${string}/${string}`,
      });
    }
  }
  const instruction = buildScanInstruction(textBlocks, mediaParts.length > 0);
  return { instruction, mediaParts };
}

// One classification attempt. Returns a verdict, or throws to trigger a retry.
async function scanOnce(targets: ScanTarget[]): Promise<SafetyVerdict> {
  const cfg = getSafetyConfig();
  const google = createGoogleGenerativeAI({ apiKey: requireApiKey() });
  const model = google(cfg.model);
  const { instruction, mediaParts } = toContentParts(targets);

  const { output, finishReason } = await generateText({
    model,
    temperature: 0,
    system: SAFETY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: instruction }, ...mediaParts],
      },
    ],
    providerOptions: { google: { safetySettings: CLASSIFIER_SAFETY_SETTINGS } },
    output: Output.object({ schema: SafetyVerdictSchema }),
  });

  // The non-configurable filter tripped even with BLOCK_NONE → strong harm
  // signal (usually child-safety). Treat as a critical verdict, not an error.
  if (finishReason === "content-filter") {
    return providerBlockedVerdict("finishReason=content-filter");
  }
  return output;
}

// Scans pre-built targets with retries. On exhausting retries (Gemini
// down/timeout) it throws SafetyScanError → the worker fails the job RETRYABLY
// (fail-closed: never publish unscanned content). A provider safety block is NOT
// an error — it returns a critical verdict.
export async function scanContent(
  targets: ScanTarget[],
  opts?: { logger?: StageLog },
): Promise<SafetyVerdict> {
  const cfg = getSafetyConfig();
  let lastError: unknown;
  for (let attempt = 0; attempt <= cfg.scanRetries; attempt++) {
    try {
      const verdict = await scanOnce(targets);
      opts?.logger?.("safety:verdict", {
        attempt,
        safe: verdict.safe,
        severity: verdict.severity,
        categories: verdict.categories,
      });
      return verdict;
    } catch (error) {
      lastError = error;
      // A thrown provider safety block (NoObjectGeneratedError w/ content-filter)
      // is a harm signal, not a transient failure → critical verdict.
      if (looksLikeProviderBlock(error)) {
        opts?.logger?.("safety:provider-block", {
          attempt,
          detail: error instanceof Error ? error.message : String(error),
        });
        return providerBlockedVerdict(
          error instanceof Error ? error.message : String(error),
        );
      }
      opts?.logger?.("safety:retry", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new SafetyScanError(
    lastError instanceof Error ? lastError.message : String(lastError),
    lastError,
  );
}
