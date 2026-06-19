// Composes the ingest stages into the function the worker calls per claim.
// Two stages: run Gemini, then persist the post directly to the database.
// (copt-dev's git branch + commit + push + gh PR steps are intentionally
// dropped — see the migration plan.)

import { buildClassificationInput } from "./classification/adapters";
import { assignOrg, sceneRowWarning } from "./classification/assign-org";
import { tryClientDraft } from "./draft-runner";
import { runGemini } from "./gemini-runner";
import { writePost } from "./post-writer";
import type { PipelineInput, PipelineResult } from "./types";

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
		});
		throw error;
	}
}

export async function processIngest(
	input: PipelineInput,
	logger: StageLogger = noopLogger,
): Promise<PipelineResult> {
	// A valid client-supplied draft (drafted on-device by the mobile app) skips
	// the Gemini stage entirely; an absent or invalid draft falls through.
	const drafted = tryClientDraft(input);
	const parsed =
		drafted ?? (await timed("gemini", logger, () => runGemini(input)));
	logger(drafted ? "draft:client" : "gemini:parsed", {
		title: parsed.title,
		slug: parsed.slug,
		type: parsed.type,
	});
	const written = await timed("post:write", logger, () =>
		writePost(parsed, input),
	);
	logger("post:write:done", {
		postId: written.postId,
		slug: written.slug,
		images: written.imagePaths.length,
	});

	// Auto-org: file unscoped, user-attributed ingests under a Project. Runs here
	// (after writePost, before the worker deletes staged files) so image batches
	// can be embedded multimodally. Non-fatal by contract — a classification error
	// must not fail an otherwise-successful ingest.
	try {
		const classificationInput = buildClassificationInput(input, parsed);
		const org = await assignOrg({
			input,
			postId: written.postId,
			classificationInput,
		});
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

	return {
		postSlug: written.slug,
		postId: written.postId,
	};
}
