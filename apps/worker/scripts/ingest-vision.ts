// Ingest the product vision doc (initial-vision.md) as REAL content through the
// live worker pipeline, attributed to a real user. Splits the doc into a handful
// of coherent NOTE pieces — one for the Vision Statement and one per Phase — and
// enqueues each as a NOTE IngestSubmission (kind:"note") via createSubmission.
// The script ONLY enqueues; the RUNNING worker (bun run worker:dev) claims each
// pending row (claimNextNonImage), drafts it through Gemini, and runs assignOrg —
// producing real BLOG Posts (notes force BLOG), embeddings, taxonomy, and an auto
// Aspiration/Project. It does NOT call the pipeline directly.
//
// Run: bun run apps/worker/scripts/ingest-vision.ts
//
// Flags:
//   --user <email>  Target user to attribute the notes to.
//                   Default: saleebmina@icloud.com. Must exist (fails loudly).
//   --force         Re-ingest even if an identical note was submitted before
//                   (salts the contentHash so the dedup unique index won't skip).
//
// Idempotent: relies on IngestSubmission.contentHash's unique index — re-running
// without --force logs "deduped" for pieces already submitted.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createSubmission, prisma } from "@repo/db";

const VISION_PATH = fileURLToPath(
  new URL("../../../initial-vision.md", import.meta.url),
);
const DEFAULT_USER_EMAIL = "saleebmina@icloud.com";

interface Args {
  userEmail: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  let userEmail = DEFAULT_USER_EMAIL;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--user") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--user requires an email argument");
      }
      userEmail = next;
      i += 1;
    }
  }
  return { userEmail, force };
}

// Replicates apps/web/lib/ingest/hash.ts contentHashForUrls for a note (urls=[]).
// Scripts CANNOT import from apps/web, so the tiny hash is reproduced here. When
// force is set, the hash is salted with the current time so re-ingest is allowed.
function contentHashForNote(notes: string, force: boolean): string {
  const base = JSON.stringify({ urls: [] as string[], notes: notes.trim() });
  const salted = force ? `${base}|force:${Date.now()}` : base;
  return createHash("sha256").update(salted).digest("hex");
}

// Split the vision doc into coherent NOTE pieces: the Vision Statement section
// and one piece per Phase. Each piece keeps its "## " heading + body. Parsing is
// deliberately simple/robust — split on top-level "## " headings, keep only the
// Vision Statement and Phase sections. Falls back to the whole doc as one note if
// parsing yields nothing.
function splitVisionPieces(doc: string): string[] {
  const lines = doc.split("\n");
  const sections: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) {
        sections.push(current.join("\n").trim());
      }
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) {
    sections.push(current.join("\n").trim());
  }

  const pieces = sections.filter((section) => {
    const heading = section.split("\n", 1)[0]?.toLowerCase() ?? "";
    return heading.includes("vision statement") || heading.includes("phase");
  });

  if (pieces.length === 0) {
    const whole = doc.trim();
    return whole ? [whole] : [];
  }
  return pieces;
}

function headingOf(piece: string): string {
  return (piece.split("\n", 1)[0] ?? "").replace(/^#+\s*/, "").trim();
}

async function main(): Promise<void> {
  const { userEmail, force } = parseArgs(process.argv.slice(2));

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    console.error(
      `No user found with email "${userEmail}". ` +
        `Pass --user <email> with an existing account; refusing to fabricate one.`,
    );
    process.exit(1);
  }

  const doc = await readFile(VISION_PATH, "utf8");
  const pieces = splitVisionPieces(doc);
  if (pieces.length === 0) {
    console.error(`No content parsed from ${VISION_PATH}; nothing to ingest.`);
    process.exit(1);
  }

  let created = 0;
  let deduped = 0;

  for (const piece of pieces) {
    const contentHash = contentHashForNote(piece, force);
    const result = await createSubmission({
      kind: "note",
      payload: { urls: [], notes: piece, force },
      contentHash,
      submittedById: user.id,
      force,
    });
    if (result.status === "created") {
      created += 1;
    } else {
      deduped += 1;
    }
    console.log(`${result.status}: ${headingOf(piece)}`);
  }

  console.log(
    `\nVision ingest enqueued for ${userEmail}: ` +
      `${created} created, ${deduped} deduped (${pieces.length} piece(s)).`,
  );
  console.log(
    "Reminder: the worker must be running to draft these — `bun run worker:dev`.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
