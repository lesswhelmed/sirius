// Instagram-specific Gemini runner. One structured call:
//   evidence (Apify) + image bytes -> InstagramContentDigest (strict schema)
// The post body, title, tags, and categories are then assembled
// deterministically from the digest — no second prose pass — so the durable
// artifact is the structured digest.

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { getAIConfig } from "../../lib/ai-config";
import {
  parseInstagramUrl,
  type InstagramUrlParse,
} from "../../lib/instagram-url";
import { toGeminiOutput, type PostDraft } from "../gemini-runner";
import type { GeminiOutput } from "../types";
import { fetchInstagramEvidence } from "./apify";
import {
  buildDigestPrompt,
  buildRetrievalTextFallback,
  InstagramContentDigestSchema,
  type InstagramContentDigest,
} from "./digest";
import type { InstagramEvidence } from "./types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type InstagramRunOptions = {
  url: string;
  notes: string;
};

export type InstagramRunResult = {
  output: GeminiOutput;
  evidence: InstagramEvidence;
  digest: InstagramContentDigest;
  parse: InstagramUrlParse;
  apify: { actorId: string; runId: string; datasetId: string };
};

async function fetchImageBytes(
  url: string
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

function slugifyTaxonomy(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untagged"
  );
}

function dedupe(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = slugifyTaxonomy(raw);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function buildTitle(
  evidence: InstagramEvidence,
  digest: InstagramContentDigest
): string {
  const owner = evidence.owner.username
    ? `@${evidence.owner.username}`
    : "Instagram";
  const subject = digest.visual.primarySubject?.trim() || digest.domainSignals.domain;
  const titleSubject = subject ? subject.replace(/\s+/g, " ").trim() : "post";
  // Keep titles plain and readable; the digest carries the rich data.
  const base = `${owner} — ${titleSubject}`;
  return base.length > 120 ? `${base.slice(0, 117).trimEnd()}…` : base;
}

function buildBody(
  evidence: InstagramEvidence,
  digest: InstagramContentDigest
): string {
  const lines: string[] = [];
  if (evidence.owner.username) {
    const profileUrl = `https://www.instagram.com/${evidence.owner.username}/`;
    lines.push(
      `Owner: [@${evidence.owner.username}](${profileUrl})${
        evidence.owner.isVerified ? " (verified)" : ""
      }`
    );
    lines.push("");
  }
  if (evidence.primaryImageUrl) {
    lines.push(
      `[View image on Instagram →](${evidence.primaryImageUrl})`
    );
    lines.push("");
  }
  lines.push("## What's here");
  lines.push(digest.visual.summary.trim());
  if (digest.visual.objects.length > 0) {
    lines.push("");
    lines.push(`Objects: ${digest.visual.objects.join(", ")}.`);
  }
  if (digest.visual.patterns.length > 0) {
    lines.push(`Patterns: ${digest.visual.patterns.join(", ")}.`);
  }
  if (digest.visual.materials.length > 0) {
    lines.push(`Materials: ${digest.visual.materials.join(", ")}.`);
  }
  if (digest.visual.colors.length > 0) {
    lines.push(`Colors: ${digest.visual.colors.join(", ")}.`);
  }
  if (digest.garments.length > 0) {
    lines.push("");
    lines.push("## Garments");
    for (const g of digest.garments) {
      lines.push(`- **${g.type}** — ${g.silhouette}. ${g.fabricNotes}`.trim());
      if (g.constructionDetails.length > 0) {
        lines.push(`  - Construction: ${g.constructionDetails.join("; ")}`);
      }
      if (g.fasteners.length > 0) {
        lines.push(`  - Fasteners: ${g.fasteners.join(", ")}`);
      }
      if (g.labelsVisible.length > 0) {
        lines.push(`  - Labels: ${g.labelsVisible.join(" | ")}`);
      }
      if (g.condition) {
        lines.push(`  - Condition: ${g.condition}`);
      }
    }
  }
  if (
    digest.domainSignals.patternFamilyHypothesis ||
    digest.domainSignals.eraHypothesis ||
    digest.domainSignals.regionHypothesis ||
    digest.domainSignals.brandHypothesis ||
    digest.domainSignals.additionalClaims.length > 0
  ) {
    lines.push("");
    lines.push("## Hypotheses");
    const claims = [
      digest.domainSignals.patternFamilyHypothesis &&
        ["pattern", digest.domainSignals.patternFamilyHypothesis],
      digest.domainSignals.eraHypothesis &&
        ["era", digest.domainSignals.eraHypothesis],
      digest.domainSignals.regionHypothesis &&
        ["region", digest.domainSignals.regionHypothesis],
      digest.domainSignals.brandHypothesis &&
        ["brand", digest.domainSignals.brandHypothesis],
    ].filter(Boolean) as Array<
      [string, NonNullable<InstagramContentDigest["domainSignals"]["eraHypothesis"]>]
    >;
    for (const [label, claim] of claims) {
      lines.push(`- **${label}**: ${claim.value} _(${claim.confidence})_ — ${claim.evidence}`);
    }
    for (const claim of digest.domainSignals.additionalClaims) {
      lines.push(`- ${claim.value} _(${claim.confidence})_ — ${claim.evidence}`);
    }
  }
  if (evidence.caption) {
    lines.push("");
    lines.push("## Caption");
    lines.push(digest.captionAnalysis.cleanedCaption || evidence.caption);
  }
  return `${lines.join("\n").trim()}\n`;
}

function deriveTaxonomy(
  digest: InstagramContentDigest,
  evidence: InstagramEvidence
): { tags: string[]; categories: string[] } {
  const tagSource = [
    ...digest.classificationPrep.keywords,
    ...digest.visual.patterns,
    ...digest.visual.objects,
    ...evidence.hashtags,
  ];
  const tags = dedupe(tagSource, 5);
  if (tags.length === 0) {
    tags.push("instagram");
  }
  const categories = dedupe(
    [
      ...digest.classificationPrep.candidateCategories,
      digest.domainSignals.domain,
      "instagram",
    ].filter(Boolean) as string[],
    3
  );
  if (categories.length === 0) {
    categories.push("instagram");
  }
  return { tags, categories };
}

function ensureRetrievalText(
  digest: InstagramContentDigest,
  evidence: InstagramEvidence
): InstagramContentDigest {
  if (
    digest.classificationPrep.retrievalText &&
    digest.classificationPrep.retrievalText.trim().length >= 40
  ) {
    return digest;
  }
  return {
    ...digest,
    classificationPrep: {
      ...digest.classificationPrep,
      retrievalText: buildRetrievalTextFallback(evidence, digest),
    },
  };
}

export async function runInstagramGemini(
  options: InstagramRunOptions
): Promise<InstagramRunResult | null> {
  const parse = parseInstagramUrl(options.url);
  if (!parse) {
    return null;
  }

  const fetched = await fetchInstagramEvidence({ url: parse.canonicalUrl });
  const evidence = fetched.evidence;

  const config = getAIConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  const model = google(config.model);
  const prompt = buildDigestPrompt(evidence, options.notes);

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
    output: Output.object({ schema: InstagramContentDigestSchema }),
  });

  const digest = ensureRetrievalText(output, evidence);
  const { tags, categories } = deriveTaxonomy(digest, evidence);

  const title = buildTitle(evidence, digest);
  const body = buildBody(evidence, digest);
  const slugBase = evidence.shortcode
    ? `ig-${evidence.shortcode.toLowerCase()}`
    : title;

  const draft: PostDraft = {
    title,
    slug: slugBase,
    tags,
    categories,
    body,
  };

  const result = toGeminiOutput(draft, "SOCIAL", evidence.url);
  // Surface digest + media URL on the result so the post writer can persist
  // them as first-class columns (imageUrl, contentDigest) and provider fields.
  result.frontmatter.image_url = evidence.primaryImageUrl;
  result.frontmatter.content_digest = digest as unknown as Record<
    string,
    unknown
  >;
  result.frontmatter.provider_id = "instagram";
  result.frontmatter.source_record_id =
    evidence.shortcode ?? evidence.id ?? parse.shortcode;
  result.frontmatter.apify = {
    actorId: fetched.actorId,
    runId: fetched.runId,
    datasetId: fetched.datasetId,
  };

  return {
    output: result,
    evidence,
    digest,
    parse,
    apify: {
      actorId: fetched.actorId,
      runId: fetched.runId,
      datasetId: fetched.datasetId,
    },
  };
}
