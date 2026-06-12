// Auto-org stage. For EVERY user-attributed session-auth ingest, embed the
// content's classification signal, reverse-look-up against the user's existing
// Projects and the global Analysis Category taxonomy, and persist the vector +
// category linkage (PostEmbedding + PostCategoryMatch) so the post appears in
// the embedding space. Then, for UNSCOPED ingests only (no focus selected),
// assign the best-matching Project, else reuse an existing Project/Aspiration
// whose title matches the derived names, else auto-create an Aspiration +
// Project. Runs after writePost (postId known) but before staged files are
// deleted — image parts need the bytes. All failures are NON-FATAL: the post
// already exists, so a classification error must never dead-letter an
// otherwise-successful ingest.
import {
  assignPostToProject,
  type CategoryMatch,
  classifyContent,
  createAspiration,
  createProject,
  findAspirationByTitle,
  findProjectByTitle,
  getProject,
  getProjectEmbedding,
  listProjectsNeedingEmbedding,
  replacePostCategoryMatches,
  setSubmissionProject,
  upsertPostEmbedding,
  upsertProjectEmbedding,
} from "@repo/db";
import { getClassifyConfig, getEmbeddingDimensionality, getEmbeddingModel } from "../../lib/ai-config";
import { embedContent, embeddingHash, queryPrefix } from "../../lib/embeddings";
import type { PipelineInput } from "../types";
import type { ClassificationInput } from "./adapters";

export interface AssignOrgArgs {
  input: PipelineInput;
  postId: string;
  classificationInput: ClassificationInput;
}

export type AssignOrgResult = { projectId: string; created: boolean } | null;

function submissionIdsOf(input: PipelineInput): string[] {
  return input.kind === "image"
    ? input.submissions.map((s) => s.id)
    : [input.submission.id];
}

// "cargo-pants" / "cargo pants" -> "Cargo Pants"
function titleCaseWords(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Deterministic names for an auto-created org (no extra LLM call). Project title
// comes from the model's most-specific candidate category; the Aspiration
// (scope) from a matched broad-domain analysis category, falling back to the
// content's domain hint.
function deriveOrgNames(
  classificationInput: ClassificationInput,
  categories: CategoryMatch[]
): { projectTitle: string; aspirationTitle: string; description: string } {
  const { prep } = classificationInput;
  const projectTitle = titleCaseWords(
    prep.candidateCategories[0] ?? categories[0]?.name ?? "new-capture"
  );
  const domainCategory = categories.find((c) =>
    c.path.startsWith("analysis/domain/")
  );
  const aspirationTitle = titleCaseWords(
    domainCategory?.name ?? prep.domainHint ?? "general"
  );
  const related = categories.map((c) => c.name).slice(0, 4).join(", ");
  const description = related
    ? `Auto-created from captured material. Related analysis: ${related}.`
    : "Auto-created from captured material.";
  return { projectTitle, aspirationTitle, description };
}

// Count-weighted mean of the project's existing vector and a newly-filed
// post's vector, L2-normalized. Cosine is scale-invariant, but normalizing
// keeps repeated folds from drifting in magnitude.
function foldIntoCentroid(
  existing: number[],
  existingWeight: number,
  next: number[]
): number[] {
  if (existing.length !== next.length) {
    return next;
  }
  const total = existingWeight + 1;
  const merged = existing.map((v, i) => (v * existingWeight + next[i]!) / total);
  const norm = Math.sqrt(merged.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? next : merged.map((v) => v / norm);
}

// Fold this content into the project's embedding as a running centroid so the
// vector tracks what's actually filed under the project instead of staying
// pinned to its seed (one post, or just the title for manual projects). Without
// this, the next similar capture rarely clears projectMatchMin and auto-org
// mints yet another project. retrievalText/embeddingHash record the most recent
// contribution — for a centroid there is no single source text.
async function updateProjectCentroid(args: {
  projectId: string;
  ownerId: string;
  contentEmbedding: number[];
  retrievalText: string;
  modelVersion: string;
  dimensionality: number;
}): Promise<void> {
  const { projectId, ownerId, contentEmbedding } = args;
  const [existing, project] = await Promise.all([
    getProjectEmbedding(projectId),
    getProject(ownerId, projectId),
  ]);
  // The old vector stood for every post before this one (or the seed) — weight
  // it by the prior post count, floor 1 so a title-only seed still counts.
  const priorWeight = Math.max(1, (project?._count.posts ?? 1) - 1);
  const embedding =
    existing && existing.dimensionality === args.dimensionality
      ? foldIntoCentroid(existing.embedding, priorWeight, contentEmbedding)
      : contentEmbedding;
  await upsertProjectEmbedding({
    projectId,
    ownerId,
    retrievalText: args.retrievalText,
    embedding,
    embeddingHash: embeddingHash(queryPrefix(args.retrievalText)),
    modelVersion: args.modelVersion,
    dimensionality: args.dimensionality,
  });
}

// Lazy backfill: embed any active Projects this owner has that don't yet carry a
// ProjectEmbedding, so manually-created Projects join the reverse-lookup index.
// Uses the SAME queryPrefix as content so the vectors are directly comparable.
async function ensureProjectEmbeddings(ownerId: string): Promise<void> {
  const pending = await listProjectsNeedingEmbedding(ownerId);
  if (pending.length === 0) {
    return;
  }
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();
  for (const project of pending) {
    const retrievalText = [project.title, project.description ?? ""]
      .filter(Boolean)
      .join(". ");
    const embedding = await embedContent([{ text: queryPrefix(retrievalText) }], {
      dimensionality,
    });
    await upsertProjectEmbedding({
      projectId: project.id,
      ownerId,
      retrievalText,
      embedding,
      embeddingHash: embeddingHash(queryPrefix(retrievalText)),
      modelVersion,
      dimensionality,
    });
  }
}

export async function assignOrg(args: AssignOrgArgs): Promise<AssignOrgResult> {
  const { input, postId, classificationInput } = args;
  const ownerId = input.submittedById;
  const config = getClassifyConfig();

  // Bearer ingest (no user) is never embedded or auto-filed.
  if (!config.enabled || ownerId == null) {
    return null;
  }

  const ids = submissionIdsOf(input);
  const dimensionality = getEmbeddingDimensionality();
  const modelVersion = getEmbeddingModel();

  // Make sure existing manual projects are matchable before we compare.
  await ensureProjectEmbeddings(ownerId);

  const contentEmbedding = await embedContent(classificationInput.parts, {
    dimensionality,
  });

  const { categories, bestProject } = await classifyContent({
    ownerId,
    contentEmbedding,
    projectMatchMin: config.projectMatchMin,
    categoryMatchMin: config.categoryMatchMin,
  });

  // Persist the vector + category linkage for EVERY user-attributed ingest so
  // the 3D embedding space covers scoped and unscoped content alike.
  await upsertPostEmbedding({
    postId,
    ownerId,
    retrievalText: classificationInput.prep.retrievalText,
    embedding: contentEmbedding,
    embeddingHash: embeddingHash(queryPrefix(classificationInput.prep.retrievalText)),
    modelVersion,
    dimensionality,
  });
  await replacePostCategoryMatches(
    postId,
    categories.map((c) => ({ path: c.path, score: c.score }))
  );

  // Explicitly-scoped ingests keep their user-chosen Project — no auto-org.
  if (input.projectId != null) {
    return null;
  }

  const centroidArgs = {
    ownerId,
    contentEmbedding,
    retrievalText: classificationInput.prep.retrievalText,
    modelVersion,
    dimensionality,
  };

  if (bestProject) {
    const result = await assignPostToProject(ownerId, postId, bestProject.projectId);
    if (result.ok) {
      await setSubmissionProject(ids, bestProject.projectId);
      await updateProjectCentroid({
        projectId: bestProject.projectId,
        ...centroidArgs,
      });
      return { projectId: bestProject.projectId, created: false };
    }
    return null;
  }

  // No embedding match. Derived names repeat constantly ("Journal",
  // "Lifestyle"), so reuse an existing row by title before minting anything —
  // a title hit IS the dedup signal the embedding comparison missed.
  const { projectTitle, aspirationTitle, description } = deriveOrgNames(
    classificationInput,
    categories
  );

  const existingProject = await findProjectByTitle(ownerId, projectTitle);
  if (existingProject) {
    const assigned = await assignPostToProject(ownerId, postId, existingProject.id);
    if (!assigned.ok) {
      return null;
    }
    await setSubmissionProject(ids, existingProject.id);
    await updateProjectCentroid({ projectId: existingProject.id, ...centroidArgs });
    return { projectId: existingProject.id, created: false };
  }

  const aspiration =
    (await findAspirationByTitle(ownerId, aspirationTitle)) ??
    (await createAspiration({
      ownerId,
      title: aspirationTitle,
      description,
      metadata: { autoCreated: true },
    }));
  const created = await createProject({
    ownerId,
    title: projectTitle,
    description,
    aspirationId: aspiration.id,
    metadata: { autoCreated: true },
  });
  if (!created.ok) {
    return null;
  }
  const projectId = created.project.id;

  const assigned = await assignPostToProject(ownerId, postId, projectId);
  if (!assigned.ok) {
    return null;
  }
  await setSubmissionProject(ids, projectId);

  // Seed the new project's vector with this first piece of content so similar
  // future content matches it.
  await upsertProjectEmbedding({
    projectId,
    ownerId,
    retrievalText: classificationInput.prep.retrievalText,
    embedding: contentEmbedding,
    embeddingHash: embeddingHash(queryPrefix(classificationInput.prep.retrievalText)),
    modelVersion,
    dimensionality,
  });

  return { projectId, created: true };
}
