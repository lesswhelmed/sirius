// Auto-org stage. For EVERY user-attributed session-auth ingest, embed the
// content's classification signal, reverse-look-up against the user's existing
// Projects and the dynamic topic taxonomy (grown entirely from user content),
// and persist the vector + category linkage (PostEmbedding + PostCategoryMatch)
// so the post appears in the embedding space. Then, for UNSCOPED ingests only
// (no focus selected),
// assign the best-matching Project, else reuse an existing Project/Aspiration
// whose title matches the derived names, else auto-create an Aspiration +
// Project. Runs after writePost (postId known) but before staged files are
// deleted — image parts need the bytes. All failures are NON-FATAL: the post
// already exists, so a classification error must never dead-letter an
// otherwise-successful ingest.
import {
  addPostTags,
  assignPostToProject,
  type CategoryMatch,
  classifyContent,
  createAspiration,
  createProject,
  deleteOrphanCategories,
  findAspirationByTitle,
  findProjectByTitle,
  getProject,
  getProjectEmbedding,
  listProjectsNeedingEmbedding,
  removePostTags,
  replacePostCategoryMatches,
  setPostCategories,
  setSubmissionProject,
  upsertPostEmbedding,
  upsertProjectEmbedding,
} from "@repo/db";
import {
  getClassifyConfig,
  getEmbeddingDimensionality,
  getEmbeddingModel,
} from "../../lib/ai-config";
import { embedContent, embeddingHash, queryPrefix } from "../../lib/embeddings";
import type { PipelineInput } from "../types";
import type { ClassificationInput } from "./adapters";
import { type ResolvedTopic, resolveCategoryPaths } from "./resolve-categories";
import { selectPrimaryCategory } from "./select-primary";

export interface AssignOrgArgs {
  input: PipelineInput;
  postId: string;
  classificationInput: ClassificationInput;
}

// Why the stage wrote no scene rows. "disabled"/"unattributed" are the expected
// no-op paths (bearer ingest or classification turned off); anything else is a
// real ingest that should have populated the embedding space and didn't.
export type AssignOrgSkipReason = "disabled" | "unattributed";

// Outcome of the auto-org stage. Always returned (never null) so the pipeline
// can tell a legitimate skip apart from an eligible ingest that silently wrote
// zero PostEmbedding/PostCategoryMatch rows. `postEmbeddingWritten` +
// `categoryMatchCount` are the scene-row metrics; `project` is the org
// assignment (null when scoped/skipped/unmatched).
export interface AssignOrgResult {
  postEmbeddingWritten: boolean;
  categoryMatchCount: number;
  project: { projectId: string; created: boolean } | null;
  skipped: AssignOrgSkipReason | null;
}

const SKIPPED: (reason: AssignOrgSkipReason) => AssignOrgResult = (reason) => ({
  postEmbeddingWritten: false,
  categoryMatchCount: 0,
  project: null,
  skipped: reason,
});

// Pure observability decision: did an ELIGIBLE ingest (not a known disabled/
// unattributed skip) land with no scene rows? An eligible ingest must write a
// PostEmbedding and at least one PostCategoryMatch to surface in the embedding
// space + Tree; zero of either means it's invisible. Returns a one-line reason
// for the structured warning, or null when there's nothing to flag.
export function sceneRowWarning(result: AssignOrgResult): string | null {
  if (result.skipped != null) {
    return null;
  }
  if (!result.postEmbeddingWritten) {
    return "no PostEmbedding written";
  }
  if (result.categoryMatchCount === 0) {
    return "no PostCategoryMatch rows (post absent from Tree)";
  }
  return null;
}

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
// comes from the model's most-specific candidate category; the Aspiration (scope)
// from the content's domain hint. Related topic names (the user-derived taxonomy
// nodes this content matched) seed the description.
function deriveOrgNames(
  classificationInput: ClassificationInput,
  categories: CategoryMatch[],
): { projectTitle: string; aspirationTitle: string; description: string } {
  const { prep } = classificationInput;
  const projectTitle = titleCaseWords(
    prep.candidateCategories[0] ?? categories[0]?.name ?? "new-capture",
  );
  const aspirationTitle = titleCaseWords(prep.domainHint ?? "general");
  const related = categories
    .map((c) => c.name)
    .slice(0, 4)
    .join(", ");
  const description = related
    ? `Auto-created from captured material. Related topics: ${related}.`
    : "Auto-created from captured material.";
  return { projectTitle, aspirationTitle, description };
}

// Count-weighted mean of the project's existing vector and a newly-filed
// post's vector, L2-normalized. Cosine is scale-invariant, but normalizing
// keeps repeated folds from drifting in magnitude.
function foldIntoCentroid(
  existing: number[],
  existingWeight: number,
  next: number[],
): number[] {
  if (existing.length !== next.length) {
    return next;
  }
  const total = existingWeight + 1;
  const merged = existing.map(
    (v, i) => (v * existingWeight + next[i]!) / total,
  );
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
    const embedding = await embedContent(
      [{ text: queryPrefix(retrievalText) }],
      {
        dimensionality,
      },
    );
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
  if (!config.enabled) {
    return SKIPPED("disabled");
  }
  if (ownerId == null) {
    return SKIPPED("unattributed");
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
    embeddingHash: embeddingHash(
      queryPrefix(classificationInput.prep.retrievalText),
    ),
    modelVersion,
    dimensionality,
  });

  // Grow/reuse the dynamic topic taxonomy from the model's proposed category
  // paths (embedding-deduped + nestable), so the post links to canonical topic
  // nodes in the Tree. Strictly non-fatal: a resolver error must not lose the
  // cosine-matched topic links or dead-letter the ingest, so we fall back to those.
  let topics: ResolvedTopic[] = [];
  try {
    topics = await resolveCategoryPaths(
      classificationInput.prep.candidateCategories,
      {
        reuseMin: config.categoryReuseMin,
      },
    );
  } catch (error) {
    console.warn(
      `[assign-org] topic resolution failed (facet-only): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // A post carries exactly ONE category — the strongest embedding match (cosine
  // matches preferred; the model's primary resolved topic as fallback). It links
  // to that single node in BOTH the hierarchical-embedding space
  // (PostCategoryMatch) and the flat Category table (colophon). The scene's
  // ownership walk in getEmbeddingSceneRows pulls the branch's ancestors via
  // parentPath, so a single leaf match still renders a connected Tree.
  const primary = selectPrimaryCategory(categories, topics);
  const categoryMatchCount = primary ? 1 : 0;
  await replacePostCategoryMatches(
    postId,
    primary ? [{ path: primary.path, score: primary.score }] : [],
  );

  // Embedding is always written above; category linkage may be empty if no topic
  // cleared its match floor. Carried out so the pipeline can flag an eligible
  // ingest that landed with no Tree linkage.
  const sceneRows = { postEmbeddingWritten: true, categoryMatchCount };

  // Reconcile the flat Category + Tag tables. The single primary becomes the
  // post's only category; every OTHER resolved topic is demoted to a filterable
  // tag (so nothing the model surfaced is lost — it just stops being a second
  // category). Non-fatal.
  if (primary) {
    try {
      await setPostCategories(postId, [primary.name]);
      // Surplus categories -> tags. addPostTags is additive (keeps the model's
      // own tags); removePostTags guarantees the primary is never ALSO a tag,
      // including the surplus rows post-writer may have demoted by order.
      const demoted = topics
        .map((t) => t.name)
        .filter((name) => name.toLowerCase() !== primary.name.toLowerCase());
      await addPostTags(postId, demoted);
      await removePostTags(postId, [primary.name]);
      // setPostCategories' relink (set: []) can orphan the path/synonym rows
      // post-writer created; prune any Category left labeling zero posts so the
      // table doesn't grow junk across ingests.
      await deleteOrphanCategories();
    } catch (error) {
      console.warn(
        `[assign-org] taxonomy reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Explicitly-scoped ingests keep their user-chosen Project — no auto-org. The
  // scene rows are still written above, so this is not a skip.
  if (input.projectId != null) {
    return { ...sceneRows, project: null, skipped: null };
  }

  const centroidArgs = {
    ownerId,
    contentEmbedding,
    retrievalText: classificationInput.prep.retrievalText,
    modelVersion,
    dimensionality,
  };

  if (bestProject) {
    const result = await assignPostToProject(
      ownerId,
      postId,
      bestProject.projectId,
    );
    if (result.ok) {
      await setSubmissionProject(ids, bestProject.projectId);
      await updateProjectCentroid({
        projectId: bestProject.projectId,
        ...centroidArgs,
      });
      return {
        ...sceneRows,
        project: { projectId: bestProject.projectId, created: false },
        skipped: null,
      };
    }
    return { ...sceneRows, project: null, skipped: null };
  }

  // No embedding match. Derived names repeat constantly ("Journal",
  // "Lifestyle"), so reuse an existing row by title before minting anything —
  // a title hit IS the dedup signal the embedding comparison missed.
  const { projectTitle, aspirationTitle, description } = deriveOrgNames(
    classificationInput,
    categories,
  );

  const existingProject = await findProjectByTitle(ownerId, projectTitle);
  if (existingProject) {
    const assigned = await assignPostToProject(
      ownerId,
      postId,
      existingProject.id,
    );
    if (!assigned.ok) {
      return { ...sceneRows, project: null, skipped: null };
    }
    await setSubmissionProject(ids, existingProject.id);
    await updateProjectCentroid({
      projectId: existingProject.id,
      ...centroidArgs,
    });
    return {
      ...sceneRows,
      project: { projectId: existingProject.id, created: false },
      skipped: null,
    };
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
    return { ...sceneRows, project: null, skipped: null };
  }
  const projectId = created.project.id;

  const assigned = await assignPostToProject(ownerId, postId, projectId);
  if (!assigned.ok) {
    return { ...sceneRows, project: null, skipped: null };
  }
  await setSubmissionProject(ids, projectId);

  // Seed the new project's vector with this first piece of content so similar
  // future content matches it.
  await upsertProjectEmbedding({
    projectId,
    ownerId,
    retrievalText: classificationInput.prep.retrievalText,
    embedding: contentEmbedding,
    embeddingHash: embeddingHash(
      queryPrefix(classificationInput.prep.retrievalText),
    ),
    modelVersion,
    dimensionality,
  });

  return {
    ...sceneRows,
    project: { projectId, created: true },
    skipped: null,
  };
}
