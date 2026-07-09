// Composes the ingest stages into the function the worker calls per claim.
// Two stages: run Gemini, then persist the post directly to the database.
// (copt-dev's git branch + commit + push + gh PR steps are intentionally
// dropped — see the migration plan.)

import {
  cancelAiGenerationReservation,
  completeAiGenerationReservation,
  PostStatus,
  recordAiGeneration,
  reserveAiGeneration,
} from "@repo/db";
import { consumeBearerAiGeneration } from "./bearer-meter";
import { buildClassificationInput } from "./classification/adapters";
import { assignOrg, sceneRowWarning } from "./classification/assign-org";
import { tryClientDraft } from "./draft-runner";
import { noObjectErrorDetail, runGemini } from "./gemini-runner";
import { buildManualStub } from "./manual-stub";
import { writePost } from "./post-writer";
import { generateReflectionPrompts } from "./reflection/generate";
import { runSafetyGate } from "./safety";
import type { GeminiOutput, PipelineInput, PipelineResult } from "./types";

export type StageLogger = (
  stage: string,
  extra?: Record<string, unknown>,
) => void;

const noopLogger: StageLogger = () => {};

async function timed<T>(
  stage: string,
  logger: StageLogger,
  fn: () => Promise<T>,
): Promise<T> {
  logger(`${stage}:start`);
  const start = Date.now();
  try {
    const result = await fn();
    logger(`${stage}:done`, { ms: Date.now() - start });
    return result;
  } catch (error) {
    logger(`${stage}:error`, {
      ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      // Surface the AI SDK's structured-output failure detail (finishReason,
      // the offending validation/parse cause, raw text) which error.message
      // hides — otherwise a dead-lettered draft tells us nothing about WHY.
      ...(noObjectErrorDetail(error) ?? {}),
    });
    throw error;
  }
}

function quotaSourceRecordId(input: PipelineInput): string {
  if (input.kind === "image") {
    return `batch:${input.batchId}`;
  }
  return input.submission.id;
}

export async function processIngest(
  input: PipelineInput,
  logger: StageLogger = noopLogger,
): Promise<PipelineResult> {
  // SAFETY GATE — runs FIRST, fully decoupled from drafting. Scans user-produced
  // material (notes/images/docs/audio/video + fetched PDFs) and either passes
  // through, throws SafetyFlagError (harmful → worker quarantines + flags, NO
  // post), or throws SafetyScanError (scan couldn't run → retryable failure;
  // fail-closed, we never publish unscanned content). Out-of-scope kinds (social
  // / YouTube links) and the disabled switch return immediately.
  await timed("safety", logger, () => runSafetyGate(input, logger));

  // Three drafting paths, in priority order:
  //   1. A valid client-supplied draft (drafted on-device by the mobile app)
  //      skips Gemini entirely and is FREE — never metered.
  //   2. Otherwise, gate the SERVER (Gemini) generation on the user's weekly
  //      quota. Pro users (and unattributed bearer ingests) always pass.
  //   3. A free user over the limit gets a DRAFT stub (no AI body) instead of a
  //      failure, so the ingest still lands and they can write it themselves.
  const userId = input.submittedById;
  const drafted = tryClientDraft(input);
  let parsed: GeminiOutput;
  let stub = false;
  let written: Awaited<ReturnType<typeof writePost>>;

  if (drafted) {
    parsed = drafted;
    logger("draft:client", {
      title: parsed.title,
      slug: parsed.slug,
      type: parsed.type,
    });
    written = await timed("post:write", logger, () =>
      writePost(parsed, input, undefined),
    );
  } else {
    // Bearer ingests (iOS Shortcut, no user) have no one to attribute a per-user
    // quota to — but they are NOT unlimited: a process-local fixed-window meter
    // caps bearer-path AI generations so a leaked INGEST_TOKEN can't run up
    // unbounded Gemini spend. Over the cap we fall back to a DRAFT stub (the
    // ingest still lands; the worker never crashes).
    if (userId == null) {
      const meter = consumeBearerAiGeneration();
      if (!meter.allowed) {
        parsed = buildManualStub(input);
        stub = true;
        logger("bearer:over-limit", {
          used: meter.used,
          limit: meter.limit,
          retryAfterMs: meter.retryAfterMs,
          title: parsed.title,
          type: parsed.type,
        });
        written = await timed("post:write", logger, () =>
          writePost(parsed, input, {
            status: PostStatus.DRAFT,
            aiTreatment: "stub",
          }),
        );
      } else {
        parsed = await timed("gemini", logger, () =>
          runGemini(input, { logger }),
        );
        logger("gemini:parsed", {
          title: parsed.title,
          slug: parsed.slug,
          type: parsed.type,
          isPro: null,
          bearerUsed: meter.used,
          bearerLimit: meter.limit,
        });
        written = await timed("post:write", logger, () =>
          writePost(parsed, input, undefined),
        );
      }
    } else {
      const decision = await reserveAiGeneration({
        userId,
        kind: input.kind,
        sourceRecordId: quotaSourceRecordId(input),
      });
      if (decision.allowed) {
        const reservationId = decision.reservationId;
        let postWritten = false;
        try {
          parsed = await timed("gemini", logger, () => runGemini(input, { logger }));
          logger("gemini:parsed", {
            title: parsed.title,
            slug: parsed.slug,
            type: parsed.type,
            isPro: decision.isPro,
          });
          written = await timed("post:write", logger, () =>
            writePost(parsed, input, undefined),
          );
          postWritten = true;
          let quotaRecorded = false;
          if (reservationId) {
            await completeAiGenerationReservation({
              reservationId,
              resultPostId: written.postId,
            });
            quotaRecorded = true;
          } else if (decision.isPro) {
            await recordAiGeneration({
              userId,
              kind: input.kind,
              resultPostId: written.postId,
            });
            quotaRecorded = true;
          }
          if (quotaRecorded) {
            logger("quota:recorded", { userId, kind: input.kind });
          }
        } catch (error) {
          if (reservationId && !postWritten) {
            await cancelAiGenerationReservation(reservationId).catch(
              (cancelError) => {
                logger("quota:reservation-cancel:error", {
                  userId,
                  reservationId,
                  error:
                    cancelError instanceof Error
                      ? cancelError.message
                      : String(cancelError),
                });
              },
            );
          }
          throw error;
        }
      } else {
        parsed = buildManualStub(input);
        stub = true;
        logger("quota:over-limit", {
          userId,
          used: decision.used,
          limit: decision.limit,
          title: parsed.title,
          type: parsed.type,
        });
        written = await timed("post:write", logger, () =>
          writePost(parsed, input, {
            status: PostStatus.DRAFT,
            aiTreatment: "stub",
          }),
        );
      }
    }
  }

  logger("post:write:done", {
    postId: written.postId,
    slug: written.slug,
    images: written.imagePaths.length,
    stub,
  });

  // Auto-org: file unscoped, user-attributed ingests under a Project. Runs here
  // (after writePost, before the worker deletes staged files) so image batches
  // can be embedded multimodally. Non-fatal by contract — a classification error
  // must not fail an otherwise-successful ingest.
  // The computed content vector is carried out for the reflection stage below.
  let contentEmbedding: number[] | null = null;
  try {
    const classificationInput = buildClassificationInput(input, parsed);
    const org = await assignOrg({
      input,
      postId: written.postId,
      classificationInput,
    });
    contentEmbedding = org.contentEmbedding;
    // Surface the scene-row metrics so a prod worker that's silently writing no
    // PostEmbedding/PostCategoryMatch is visible. A throw is caught below; an
    // eligible ingest that wrote zero rows (embedding skipped, or no category
    // linkage → absent from the Tree) is flagged here, not buried as a no-op.
    const warning = sceneRowWarning(org);
    if (warning) {
      logger("org:warn", {
        postId: written.postId,
        reason: warning,
        postEmbeddingWritten: org.postEmbeddingWritten,
        categoryMatchCount: org.categoryMatchCount,
      });
    } else {
      logger("org:assigned", {
        postId: written.postId,
        skipped: org.skipped,
        projectId: org.project?.projectId ?? null,
        created: org.project?.created ?? false,
        postEmbeddingWritten: org.postEmbeddingWritten,
        categoryMatchCount: org.categoryMatchCount,
      });
    }
  } catch (error) {
    logger("org:error", {
      postId: written.postId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Reflection stage: generate the "write your own take" questions for the
  // owner. NON-FATAL by contract (a reflection failure must never fail the
  // ingest) and FREE (ridealong flash call — never metered). Skipped for stubs
  // (no AI analysis to reflect on; the regenerate path re-runs this) and for
  // unattributed bearer ingests (no reflecting user). Kill switch:
  // REFLECTION_ENABLED=false (checked inside).
  if (!stub && userId != null) {
    try {
      const reflection = await timed("reflection", logger, () =>
        generateReflectionPrompts({
          postId: written.postId,
          ownerId: userId,
          postTitle: parsed.title,
          postExcerpt:
            typeof parsed.frontmatter.excerpt === "string"
              ? parsed.frontmatter.excerpt
              : null,
          postBody: parsed.body,
          postSlug: written.slug,
          contentEmbedding,
          logger,
        }),
      );
      logger("reflection:done", {
        postId: written.postId,
        ...("written" in reflection
          ? { written: reflection.written, batchId: reflection.batchId }
          : { skipped: reflection.skipped }),
      });
    } catch (error) {
      logger("reflection:error", {
        postId: written.postId,
        error: error instanceof Error ? error.message : String(error),
        ...(noObjectErrorDetail(error) ?? {}),
      });
    }
  }

  return {
    postSlug: written.slug,
    postId: written.postId,
    aiTreatment: stub ? "stub" : "full",
  };
}
