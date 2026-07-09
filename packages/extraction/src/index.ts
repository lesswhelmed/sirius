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

// Extraction feeds the raw-analysis structuring step (and the web /extract
// endpoint), so it must capture as much of the page as possible — the
// structuring call is instructed never to go beyond this summary, making this
// step the ceiling on analysis quality.
function buildExtractionPrompt(urls: string[], notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "You are extracting the content of web page(s) for a personal knowledge base.",
    `Today's date: ${today}.`,
    "No 'Here is' preambles. No code fences.",
    "",
    "Use the url_context tool to fetch every URL below, then write a MAXIMAL-DETAIL extraction of what each page contains: its full argument/content structure section by section, the concrete claims and evidence, notable passages quoted verbatim (attributed), the people/organizations/products/works referenced, all figures and numbers, and the page's own metadata (author, date, platform, outbound links it highlights). Capture as much specific detail as the page warrants — a later step structures this, so completeness beats brevity; do not editorialize or pad.",
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
