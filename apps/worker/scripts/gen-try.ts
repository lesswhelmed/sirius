// Blackbox generation harness: make a REAL Gemini call through the worker's
// runGemini() and print the drafted post + proof that the author voice and the
// user's notes actually reached the model. No database is touched — we pass
// submittedById:null and inject the voice via input.voiceProfile (the override
// seam in runGemini), so only GEMINI_API_KEY is required (no DATABASE_URL).
//
// This is the verification tool for the model upgrade: run it to confirm a
// model id resolves and returns valid structured output before changing the
// AI_MODEL default.
//
// Usage (from repo root so root .env loads):
//   bun run gen:try --kind note --note "weekend trip to the coast" \
//     --voice "wry, terse, lowercase; dry humor"
//   bun run gen:try --kind url  --url https://example.com --notes "focus on pricing"
//   bun run gen:try --kind image --image apps/web/public/IMG_4297.JPG --voice "..."
//   bun run gen:try --kind document --file ./paper.pdf --mime application/pdf
//
// Flags:
//   --kind   url | note | image | video | audio | document   (required)
//   --url    a URL (for --kind url; repeat or comma-separate for multiple)
//   --note   the note text         (for --kind note)
//   --notes  author's side notes   (any kind; the "Author's notes" block)
//   --voice  author voice profile  (any kind; injected style-only block)
//   --image  path to an image file (for --kind image; repeat or comma-separate)
//   --file   path to a media/doc   (for --kind video|audio|document)
//   --mime   mime type override    (for --kind video|audio|document)
//   --model  override AI_MODEL for this run
//   --temp   override AI_TEMPERATURE for this run

import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { IngestSubmission } from "@repo/db";
import { runGemini } from "../src/pipeline/gemini-runner";
import type {
  IngestKind,
  PipelineInput,
  StagedImage,
} from "../src/pipeline/types";

type Flags = Record<string, string | true>;

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function fail(message: string): never {
  console.error(`\n[gen:try] ${message}\n`);
  process.exit(1);
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

function buildInput(flags: Flags): PipelineInput {
  const kind = str(flags, "kind") as IngestKind | undefined;
  const notes = str(flags, "notes") ?? "";
  const voiceProfile = str(flags, "voice") ?? null;
  const submittedById = null;
  const projectId = null;
  // runGemini never reads input.submission, so a light stub is safe here.
  const submission = { id: "gen-try" } as unknown as IngestSubmission;

  if (kind === "note") {
    const note = str(flags, "note");
    if (!note) fail("--kind note requires --note <text>");
    return {
      kind: "note",
      submission,
      notes: note!,
      submittedById,
      projectId,
      voiceProfile,
    };
  }

  if (kind === "url") {
    const raw = str(flags, "url");
    if (!raw) fail("--kind url requires --url <url>");
    const urls = raw!.split(",").map((u) => u.trim()).filter(Boolean);
    return {
      kind: "url",
      submission,
      urls,
      notes,
      force: false,
      submittedById,
      projectId,
      voiceProfile,
    };
  }

  if (kind === "image") {
    const raw = str(flags, "image");
    if (!raw) fail("--kind image requires --image <path>[,<path>]");
    const paths = raw!.split(",").map((p) => p.trim()).filter(Boolean);
    const images: StagedImage[] = paths.map((p, index) => {
      const abs = resolve(p);
      if (!existsSync(abs)) fail(`image not found: ${abs}`);
      return {
        submissionId: `gen-try-${index}`,
        index,
        stagedFilePath: abs,
        extension: extname(abs).slice(1).toLowerCase() || "jpg",
      };
    });
    return {
      kind: "image",
      submissions: [],
      batchId: "gen-try",
      notes,
      images,
      submittedById,
      projectId,
      voiceProfile,
    };
  }

  if (kind === "video" || kind === "audio" || kind === "document") {
    const file = str(flags, "file");
    if (!file) fail(`--kind ${kind} requires --file <path>`);
    const abs = resolve(file!);
    if (!existsSync(abs)) fail(`file not found: ${abs}`);
    const extension = extname(abs).slice(1).toLowerCase();
    const mimeType =
      str(flags, "mime") ?? MIME_BY_EXT[extension] ?? "application/octet-stream";
    return {
      kind,
      submission,
      stagedFilePath: abs,
      mimeType,
      extension,
      notes,
      submittedById,
      projectId,
      voiceProfile,
    };
  }

  fail(
    "missing/invalid --kind (expected: url | note | image | video | audio | document)",
  );
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // Per-run model/temperature overrides: runGemini reads getAIConfig() (env) at
  // call time, so setting these before the call is enough.
  const model = str(flags, "model");
  if (model) process.env.AI_MODEL = model;
  const temp = str(flags, "temp");
  if (temp) process.env.AI_TEMPERATURE = temp;

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    fail("GEMINI_API_KEY (or GOOGLE_API_KEY) is required — set it in root .env");
  }

  const input = buildInput(flags);

  let proof: Record<string, unknown> | null = null;
  const logger = (stage: string, extra?: Record<string, unknown>) => {
    if (stage === "prompt:built") proof = extra ?? {};
  };

  const startedAt = Date.now();
  const out = await runGemini(input, { logger });
  const ms = Date.now() - startedAt;

  console.log("\n=== DRAFT ===");
  console.log(`type:       ${out.type}`);
  console.log(`title:      ${out.title}`);
  console.log(`slug:       ${out.slug}`);
  console.log(`tags:       ${JSON.stringify(out.frontmatter.tags ?? [])}`);
  console.log(
    `categories: ${JSON.stringify(out.frontmatter.categories ?? [])}`,
  );
  if (out.frontmatter.excerpt) {
    console.log(`excerpt:    ${out.frontmatter.excerpt as string}`);
  }
  console.log("\n--- body ---");
  console.log(out.body.trim());

  console.log("\n=== PROOF ===");
  if (proof) {
    const p = proof as {
      voiceApplied?: boolean;
      voiceChars?: number;
      notesApplied?: boolean;
      notesChars?: number;
      model?: string;
      temperature?: number;
      kind?: string;
    };
    console.log(`kind:         ${p.kind}`);
    console.log(`model:        ${p.model}`);
    console.log(`temperature:  ${p.temperature}`);
    console.log(
      `voiceApplied: ${p.voiceApplied}  (${p.voiceChars ?? 0} chars)`,
    );
    console.log(
      `notesApplied: ${p.notesApplied}  (${p.notesChars ?? 0} chars)`,
    );
  } else {
    // Dedicated runners (instagram/twitter/youtube/github/document) build their
    // own prompts and don't emit prompt:built; the proof line is best-effort.
    console.log(
      "(no prompt:built signal — a dedicated runner handled this kind)",
    );
  }
  console.log(`elapsed:      ${ms}ms`);
  console.log("");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
