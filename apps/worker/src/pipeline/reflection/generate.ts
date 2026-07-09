// Reflection stage: after a post's raw analysis is written and classified,
// generate 3-5 personalized questions inviting the OWNER to write their own
// take — the human-written layer the analysis pivot deliberately left to the
// user. This is where the author's voiceProfile now lives (it no longer shapes
// any body), joined by corpus context the drafting prompts never had: the
// owner's topics with counts, their focus areas, and the nearest existing
// posts by cosine over the embedding assign-org just computed.
//
// Contract with the pipeline: NON-FATAL and FREE. A failure here never fails
// the ingest (caller catches), and the flash call is a ridealong on an
// already-reserved generation — it must never touch reserveAiGeneration
// (product decision 2026-07-09). Kill switch: REFLECTION_ENABLED=false.

import { randomUUID } from "node:crypto";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  cosineSimilarity,
  getVoiceProfile,
  listAspirations,
  listOwnerCategories,
  listVisiblePostEmbeddings,
  notifyReflectionChanged,
  replaceReflectionPrompts,
  requireApiKey,
} from "@repo/db";
import {
  buildVoiceInstruction,
  ReflectionPromptsSchema,
} from "@repo/ingest-draft";
import { generateText, Output } from "ai";
import { getAIConfig, getReflectionConfig } from "../../lib/ai-config";
import {
  DRAFT_PROVIDER_OPTIONS,
  type StageLog,
  withObjectRetry,
} from "../gemini-runner";

const MAX_PROMPTS = 5;
const MAX_RELATED = 4;
const MAX_TOPICS = 15;
const MAX_FOCUS_AREAS = 8;
const BODY_CONTEXT_CHARS = 2000;
const RELATED_SNIPPET_CHARS = 140;

export type ReflectionContext = {
  postTitle: string;
  postExcerpt: string | null;
  postBody: string;
  voiceProfile: string | null;
  // Owner's topics, descending post count: "artificial-intelligence (12)".
  topics: string[];
  // Owner's focus areas / aspirations by title.
  focusAreas: string[];
  // Nearest existing posts: { title, snippet }.
  related: { title: string; snippet: string }[];
};

// Pure prompt builder — exported for unit tests.
export function buildReflectionPrompt(ctx: ReflectionContext): string {
  const lines = [
    "You are writing reflection questions for the OWNER of a personal knowledge base. They just captured the material analyzed below; the questions invite them to write their own take on it, in their own words.",
    "Address the author directly as 'you'. Generate 3-5 questions, most compelling first.",
    "Each question must be specific to THIS material — its actual claims, details, or tensions — and, where the context genuinely supports it, connect it to the author's existing interests and library so the question intrigues them personally.",
    "Good questions make the author think: challenge a claim, connect to something they already collected, ask what they'd do differently, surface what drew them to save this. Never generic filler ('what do you think?', 'did you find this interesting?').",
    "Answering should feel inviting, not like homework — a paragraph of their own words at most. Include a one-line rationale when the 'why this question' isn't obvious from the question itself.",
  ];
  const voiceBlock = buildVoiceInstruction(ctx.voiceProfile);
  if (voiceBlock) {
    lines.push(
      "",
      "An AUTHOR VOICE block follows — use it to phrase the questions in the register that resonates with how this author thinks and writes (it never changes the JSON structure).",
      voiceBlock,
    );
  }
  if (ctx.topics.length > 0) {
    lines.push(
      "",
      "The author's existing topics (post counts in parentheses):",
      ctx.topics.map((t) => `  - ${t}`).join("\n"),
    );
  }
  if (ctx.focusAreas.length > 0) {
    lines.push(
      "",
      "The author's focus areas:",
      ctx.focusAreas.map((t) => `  - ${t}`).join("\n"),
    );
  }
  if (ctx.related.length > 0) {
    lines.push(
      "",
      "The closest existing posts in their library (candidates to connect a question to):",
      ctx.related.map((r) => `  - ${r.title} — ${r.snippet}`).join("\n"),
    );
  }
  lines.push(
    "",
    "The newly captured material:",
    `Title: ${ctx.postTitle}`,
    ...(ctx.postExcerpt ? [`Excerpt: ${ctx.postExcerpt}`] : []),
    "Analysis (may be truncated):",
    ctx.postBody.slice(0, BODY_CONTEXT_CHARS),
  );
  return lines.join("\n");
}

export type GenerateReflectionArgs = {
  postId: string;
  ownerId: string;
  postTitle: string;
  postExcerpt: string | null;
  postBody: string;
  postSlug: string;
  // The vector assign-org computed for this ingest (pass-through so we never
  // re-embed). Null → related-posts context is simply omitted.
  contentEmbedding: number[] | null;
  logger?: StageLog;
};

export type GenerateReflectionResult =
  | { written: number; batchId: string }
  | { skipped: "disabled" | "no-prompts" };

export async function generateReflectionPrompts(
  args: GenerateReflectionArgs,
): Promise<GenerateReflectionResult> {
  const reflectionConfig = getReflectionConfig();
  if (!reflectionConfig.enabled) {
    return { skipped: "disabled" };
  }

  // Corpus context — all cheap owner-scoped reads; each degrades to empty on
  // its own failure so partial context never kills the stage.
  const [voiceProfile, topics, focusAreas, related] = await Promise.all([
    getVoiceProfile(args.ownerId).catch(() => null),
    listOwnerCategories(args.ownerId)
      .then((cats) =>
        cats
          .slice(0, MAX_TOPICS)
          .map((c) => `${c.displayName ?? c.name} (${c.count})`),
      )
      .catch(() => [] as string[]),
    listAspirations(args.ownerId, { limit: MAX_FOCUS_AREAS })
      .then((page) => page.items.map((a) => a.title))
      .catch(() => [] as string[]),
    relatedPostsContext(args).catch(() => [] as { title: string; snippet: string }[]),
  ]);

  const prompt = buildReflectionPrompt({
    postTitle: args.postTitle,
    postExcerpt: args.postExcerpt,
    postBody: args.postBody,
    voiceProfile,
    topics,
    focusAreas,
    related,
  });

  const config = getAIConfig(requireApiKey());
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const model = google(reflectionConfig.model);

  const { output } = await withObjectRetry("reflection", args.logger, () =>
    generateText({
      model,
      temperature: config.temperature,
      prompt,
      providerOptions: DRAFT_PROVIDER_OPTIONS,
      output: Output.object({ schema: ReflectionPromptsSchema }),
    }),
  );

  // Clamp in code, never in the schema (Gemini ignores array bounds).
  const prompts = (output.prompts ?? []).slice(0, MAX_PROMPTS);
  if (prompts.length === 0) {
    return { skipped: "no-prompts" };
  }

  const batchId = randomUUID();
  const rows = await replaceReflectionPrompts({
    postId: args.postId,
    batchId,
    prompts,
  });

  // Best-effort SSE nudge so a connected device pulls the reflection delta.
  await notifyReflectionChanged({
    op: "upsert",
    postId: args.postId,
    ownerId: args.ownerId,
    updatedAt: new Date().toISOString(),
  }).catch((error) => {
    args.logger?.("reflection:notify:error", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return { written: rows.length, batchId };
}

// Nearest existing posts by cosine over the owner's stored vectors, excluding
// the post being processed. Empty when the ingest produced no embedding.
async function relatedPostsContext(
  args: GenerateReflectionArgs,
): Promise<{ title: string; snippet: string }[]> {
  if (!args.contentEmbedding || args.contentEmbedding.length === 0) {
    return [];
  }
  const candidates = await listVisiblePostEmbeddings(args.ownerId, [], false);
  return candidates
    .filter((c) => c.slug !== args.postSlug)
    .map((c) => ({
      title: c.title,
      snippet: c.retrievalText.slice(0, RELATED_SNIPPET_CHARS),
      score: cosineSimilarity(args.contentEmbedding as number[], c.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELATED)
    .map(({ title, snippet }) => ({ title, snippet }));
}
