// X / Twitter Gemini runner. One structured call:
//   evidence (Apify) + optional photo bytes -> PostDraft (shared schema)
// Mirrors the lightweight one-call shape of the GitHub path: the tweet is
// mostly text, so we let Gemini draft straight into PostDraftSchema rather than
// running a heavy custom digest like Instagram. The worker forces the post type
// to SOCIAL after the model returns.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { PostDraft } from "@repo/ingest-draft";
import { buildVoiceInstruction, PostDraftSchema } from "@repo/ingest-draft";
import { generateText, Output } from "ai";
import { getAIConfig, getHeavyModel } from "../../lib/ai-config";
import { parseTwitterUrl, type TwitterUrlParse } from "../../lib/twitter-url";
import { toGeminiOutput } from "../gemini-runner";
import type { GeminiOutput } from "../types";
import { fetchTwitterEvidence } from "./apify";
import type { TwitterEvidence } from "./types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type TwitterRunOptions = {
  url: string;
  notes: string;
  voiceProfile?: string | null;
};

export type TwitterRunResult = {
  output: GeminiOutput;
  evidence: TwitterEvidence;
  parse: TwitterUrlParse;
  apify: { provider: string; actorId: string; runId: string; datasetId: string };
};

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!response.ok) {
      return null;
    }
    const buf = await response.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const mediaType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    return { bytes: new Uint8Array(buf), mediaType };
  } catch {
    return null;
  }
}

function formatCount(n: number | null): string | null {
  return typeof n === "number" ? n.toLocaleString("en-US") : null;
}

function buildTwitterPrompt(
  evidence: TwitterEvidence,
  notes: string,
  voiceBlock: string,
): string {
  const author = evidence.author;
  const handle = author.username ? `@${author.username}` : "unknown author";
  const article = evidence.article;
  const lines: string[] = [
    article
      ? "You are drafting a FINDING — a saved long-form X Article (a post on X / Twitter) worth keeping and revisiting. The tweet itself is just a link; the real content is the article below."
      : "You are drafting a personal SOCIAL post that captures a tweet (a post on X / Twitter).",
    "Write in first person as the person saving this — what it says and why it's worth keeping.",
    article
      ? "Summarize and engage with the article's actual ideas in the body; do not just restate the title."
      : "",
    "Do not fabricate engagement numbers, claims, or context beyond the evidence below.",
    "",
    "## Tweet evidence",
    `Author: ${author.name ?? handle} (${handle})${author.isVerified ? " — verified" : ""}`,
  ];
  if (evidence.createdAt) {
    lines.push(`Posted: ${evidence.createdAt}`);
  }
  if (article) {
    lines.push("", "## Linked X Article (the primary content)");
    if (article.title) {
      lines.push(`Title: ${article.title}`);
    }
    lines.push(
      "",
      "Article body:",
      article.body ?? article.previewText ?? "(no article body)",
    );
  } else {
    lines.push("", "Text:", evidence.text ?? "(no text)");
  }
  if (evidence.quotedText) {
    lines.push("", "Quoted/retweeted text:", evidence.quotedText);
  }
  const engagement = [
    formatCount(evidence.likeCount) && `${formatCount(evidence.likeCount)} likes`,
    formatCount(evidence.retweetCount) &&
      `${formatCount(evidence.retweetCount)} reposts`,
    formatCount(evidence.replyCount) &&
      `${formatCount(evidence.replyCount)} replies`,
    formatCount(evidence.quoteCount) &&
      `${formatCount(evidence.quoteCount)} quotes`,
  ].filter(Boolean);
  if (engagement.length > 0) {
    lines.push("", `Engagement: ${engagement.join(", ")}`);
  }
  if (evidence.mediaUrls.length > 0) {
    lines.push(
      "",
      `This tweet has ${evidence.mediaUrls.length} attached image(s)${evidence.primaryImageUrl ? " — the first is attached for you to look at" : ""}.`,
    );
  }
  if (notes.trim()) {
    lines.push("", "## The saver's own notes", notes.trim());
  }
  if (voiceBlock.trim()) {
    lines.push("", voiceBlock.trim());
  }
  return lines.join("\n");
}

export async function runTwitterGemini(
  options: TwitterRunOptions,
): Promise<TwitterRunResult | null> {
  const parse = parseTwitterUrl(options.url);
  if (!parse) {
    return null;
  }

  const fetched = await fetchTwitterEvidence({ parse });
  const evidence = fetched.evidence;

  const config = getAIConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  // url-derived path → heavy (Pro) tier, matching modelForKind("url").
  const model = google(getHeavyModel());
  const voiceBlock = buildVoiceInstruction(options.voiceProfile ?? null);
  const prompt = buildTwitterPrompt(evidence, options.notes, voiceBlock);

  const imageAttachment = evidence.primaryImageUrl
    ? await fetchImageBytes(evidence.primaryImageUrl)
    : null;

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Uint8Array; mediaType: string }
  > = [{ type: "text", text: prompt }];
  if (imageAttachment) {
    userContent.push({
      type: "image",
      image: imageAttachment.bytes,
      mediaType: imageAttachment.mediaType,
    });
  }

  const { output } = await generateText({
    model,
    temperature: config.temperature,
    messages: [{ role: "user", content: userContent }],
    output: Output.object({ schema: PostDraftSchema }),
  });

  const slugBase = evidence.tweetId
    ? `x-${evidence.tweetId}`
    : output.slug || output.title;

  const draft: PostDraft = {
    ...output,
    slug: slugBase,
  };

  // An X Article is substantive written content — type it FINDING (like a
  // saved URL/article), distinct from an ordinary tweet which stays SOCIAL.
  // Detection is the presence of a populated `article` object; normal tweets
  // carry no `article` field at all (verified against the apidojo actor), so
  // this can't misclassify a plain tweet.
  const forcedType = evidence.article ? "FINDING" : "SOCIAL";
  const result = toGeminiOutput(draft, forcedType, { originalUrl: evidence.url });
  // Surface media URL + digest on the result so the post writer can persist
  // them as first-class columns (imageUrl, contentDigest) and provider fields.
  result.frontmatter.image_url = evidence.primaryImageUrl;
  result.frontmatter.content_digest = {
    author: evidence.author,
    text: evidence.text,
    article: evidence.article,
    quotedText: evidence.quotedText,
    engagement: {
      likeCount: evidence.likeCount,
      retweetCount: evidence.retweetCount,
      replyCount: evidence.replyCount,
      quoteCount: evidence.quoteCount,
      viewCount: evidence.viewCount,
    },
    isReply: evidence.isReply,
    isQuote: evidence.isQuote,
    isRetweet: evidence.isRetweet,
    mediaUrls: evidence.mediaUrls,
    createdAt: evidence.createdAt,
    lang: evidence.lang,
  } as Record<string, unknown>;
  result.frontmatter.provider_id = "twitter";
  result.frontmatter.source_record_id = evidence.tweetId ?? parse.tweetId;
  result.frontmatter.apify = {
    provider: fetched.provider,
    actorId: fetched.actorId,
    runId: fetched.runId,
    datasetId: fetched.datasetId,
  };

  return {
    output: result,
    evidence,
    parse,
    apify: {
      provider: fetched.provider,
      actorId: fetched.actorId,
      runId: fetched.runId,
      datasetId: fetched.datasetId,
    },
  };
}
