// Server-side content EXTRACTION, isolated from content GENERATION. This is
// step 1 of the worker's two-step URL pipeline (Gemini's url_context tool
// fetches the page(s) and writes a plain-text summary of what's there) —
// moved here so apps/web can offer extraction as a stateless endpoint for
// on-device drafting, and the worker keeps using the identical code.
//
// Gemini rejects tools + JSON output in one request, which is why extraction
// (tools) and structuring (JSON) are separate calls; that same split is what
// lets generation move on-device.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";

export type ExtractUrlOptions = {
  urls: string[];
  // Caller-supplied free text folded into the extraction prompt. The worker
  // passes the author's notes (its historical behavior); the web extract
  // endpoint deliberately omits it so user-authored text never joins the
  // de-identified extraction call.
  notes?: string;
  apiKey: string;
  model?: string;
  temperature?: number;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.7;

// Verbatim move of the worker's url-branch extraction prompt (gemini-runner
// buildPrompt) so the worker path stays behavior-identical.
function buildExtractionPrompt(urls: string[], notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are drafting a single post for a personal blog.",
    `Today's date: ${today}.`,
    "Voice: first-person, observational, concrete. 80-300 words.",
    "No marketing copy. No 'Here is' preambles. No code fences in the body.",
    "",
    "Use the url_context tool to fetch every URL below before drafting. Summarize what you found as a short FINDING — what's on the page, why it's worth noting, anything specific that surprised you. Cite any quoted phrases inline naturally.",
    "",
    "URLs:",
  ];
  for (const url of urls) {
    lines.push(`  - ${url}`);
  }
  if (notes.trim()) {
    lines.push("", `Author's notes (verbatim): ${notes.trim()}`);
  }
  return lines.join("\n");
}

// Fetches + summarizes the URLs via Gemini url_context. Returns the plain
// summary text — the intermediate artifact between extraction and generation.
export async function extractUrlContext(
  options: ExtractUrlOptions,
): Promise<{ summary: string }> {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
  const model = google(options.model ?? DEFAULT_MODEL);
  const { text } = await generateText({
    model,
    tools: { url_context: google.tools.urlContext({}) },
    stopWhen: stepCountIs(4),
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    prompt: buildExtractionPrompt(options.urls, options.notes ?? ""),
  });
  return { summary: text };
}
