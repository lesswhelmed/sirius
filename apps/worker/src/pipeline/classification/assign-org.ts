// Auto-org stage. For an UNSCOPED session-auth ingest (no focus selected), embed
// the content's classification signal, reverse-look-up against the user's
// existing Projects and the global Analysis Category taxonomy, then either assign
// the best-matching Project or auto-create an Aspiration + Project. Runs after
// writePost (postId known) but before staged files are deleted — image parts
// need the bytes. All failures are NON-FATAL: the post already exists, so a
// classification error must never dead-letter an otherwise-successful ingest.
import {
  assignPostToProject,
  type CategoryMatch,
  classifyContent,
  createAspiration,
  createProject,
  listProjectsNeedingEmbedding,
  setSubmissionProject,
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

  // Only auto-file unscoped, user-attributed ingests. Bearer ingest (no user)
  // and explicitly-scoped ingests are left untouched.
  if (!config.enabled || input.projectId != null || ownerId == null) {
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

  if (bestProject) {
    const result = await assignPostToProject(ownerId, postId, bestProject.projectId);
    if (result.ok) {
      await setSubmissionProject(ids, bestProject.projectId);
      return { projectId: bestProject.projectId, created: false };
    }
    return null;
  }

  // No match — auto-create an Aspiration (scope) + Project (focus area).
  const { projectTitle, aspirationTitle, description } = deriveOrgNames(
    classificationInput,
    categories
  );
  const aspiration = await createAspiration({
    ownerId,
    title: aspirationTitle,
    description,
  });
  const created = await createProject({
    ownerId,
    title: projectTitle,
    description,
    aspirationId: aspiration.id,
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
