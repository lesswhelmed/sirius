// E2E smoke for the auto-org stage. Creates a throwaway user + two unscoped
// "note" ingests with similar content, runs them through assignOrg, and asserts:
//   1. the first auto-CREATES an Aspiration + Project and files the post under it
//   2. the second REUSES that same Project (similar content matches)
// Then deletes everything it created. Mutates the DB but cleans up after itself.
//
// Prereq: seed-analysis-categories.ts has been run. Needs GEMINI_API_KEY + DATABASE_URL.
// Usage (from repo root so root .env loads):
//   bun apps/worker/scripts/smoke-assign-org.ts
import { prisma } from "@repo/db";
import { buildClassificationInput } from "../src/pipeline/classification/adapters";
import { assignOrg } from "../src/pipeline/classification/assign-org";
import type { GeminiOutput, PipelineInput } from "../src/pipeline/types";

function noteDraft(title: string, body: string, tags: string[], categories: string[]): GeminiOutput {
  return {
    slug: "",
    title,
    type: "BLOG",
    body,
    frontmatter: { tags, categories },
    rawMdx: "",
  };
}

async function runOne(
  ownerId: string,
  text: string,
  draft: GeminiOutput
): Promise<{ projectId: string; created: boolean }> {
  const submission = await prisma.ingestSubmission.create({
    data: {
      kind: "note",
      payload: { notes: text },
      contentHash: `smoke-${crypto.randomUUID()}`,
      status: "completed",
      submittedById: ownerId,
    },
  });
  const post = await prisma.post.create({
    data: {
      slug: `smoke-${crypto.randomUUID()}`,
      title: draft.title,
      content: draft.body,
      type: "BLOG",
      filePath: `db://smoke/${submission.id}`,
      fileHash: crypto.randomUUID(),
      submittedById: ownerId,
    },
  });
  const input: PipelineInput = {
    kind: "note",
    submission,
    notes: text,
    submittedById: ownerId,
    projectId: null,
  };
  const classificationInput = buildClassificationInput(input, draft);
  const org = await assignOrg({ input, postId: post.id, classificationInput });
  if (!org) {
    throw new Error("assignOrg returned null (expected a result)");
  }
  // verify the post + submission were actually updated
  const refreshed = await prisma.post.findUnique({ where: { id: post.id } });
  if (refreshed?.projectId !== org.projectId) {
    throw new Error(`post.projectId (${refreshed?.projectId}) != org.projectId (${org.projectId})`);
  }
  const sub = await prisma.ingestSubmission.findUnique({ where: { id: submission.id } });
  if (sub?.projectId !== org.projectId) {
    throw new Error(`submission.projectId (${sub?.projectId}) not backfilled`);
  }
  return org;
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: {
      name: "Auto-Org Smoke",
      email: `auto-org-smoke+${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    },
  });
  console.log(`temp user: ${user.id}`);

  try {
    const first = await runOne(
      user.id,
      "Photographed a WWII woodland-camo field jacket with brass buttons for my militaria collection catalog.",
      noteDraft(
        "WWII Field Jacket",
        "A vintage woodland camouflage field jacket with brass buttons and canvas webbing, photographed for a militaria collection.",
        ["wwii", "field-jacket", "camo"],
        ["uniform", "militaria"]
      )
    );
    console.log(`first  -> project ${first.projectId} created=${first.created}`);
    if (!first.created) {
      throw new Error("FAIL: first ingest should have auto-created a project");
    }

    const second = await runOne(
      user.id,
      "Another woodland camo combat coat from WWII, brass hardware, added to the same militaria collection.",
      noteDraft(
        "WWII Combat Coat",
        "A green woodland camo combat coat with brass hardware from the second world war, for the militaria collection.",
        ["wwii", "combat-coat", "camo"],
        ["uniform", "militaria"]
      )
    );
    console.log(`second -> project ${second.projectId} created=${second.created}`);
    if (second.created) {
      throw new Error("FAIL: second similar ingest should have REUSED the first project");
    }
    if (second.projectId !== first.projectId) {
      throw new Error("FAIL: second ingest matched a different project than the first");
    }

    console.log("PASS: auto-create then reuse works");
  } finally {
    // Cleanup everything owned by the temp user (order respects FKs).
    await prisma.post.deleteMany({ where: { submittedById: user.id } });
    await prisma.ingestSubmission.deleteMany({ where: { submittedById: user.id } });
    await prisma.projectEmbedding.deleteMany({ where: { ownerId: user.id } });
    await prisma.project.deleteMany({ where: { ownerId: user.id } });
    await prisma.aspiration.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("cleaned up temp data");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[smoke-assign-org] failed:", err);
    process.exit(1);
  });
