// Composes the ingest stages into the function the worker calls per claim.
// Two stages: run Gemini, then persist the post directly to the database.
// (copt-dev's git branch + commit + push + gh PR steps are intentionally
// dropped — see the migration plan.)

import { runGemini } from "./gemini-runner";
import { writePost } from "./post-writer";
import type { PipelineInput, PipelineResult } from "./types";

export type StageLogger = (
  stage: string,
  extra?: Record<string, unknown>
) => void;

const noopLogger: StageLogger = () => {};

async function timed<T>(
  stage: string,
  logger: StageLogger,
  fn: () => Promise<T>
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
    });
    throw error;
  }
}

export async function processIngest(
  input: PipelineInput,
  logger: StageLogger = noopLogger
): Promise<PipelineResult> {
  const parsed = await timed("gemini", logger, () => runGemini(input));
  logger("gemini:parsed", {
    title: parsed.title,
    slug: parsed.slug,
    type: parsed.type,
  });
  const written = await timed("post:write", logger, () =>
    writePost(parsed, input)
  );
  logger("post:write:done", {
    postId: written.postId,
    slug: written.slug,
    images: written.imagePaths.length,
  });
  return {
    postSlug: written.slug,
    postId: written.postId,
  };
}
