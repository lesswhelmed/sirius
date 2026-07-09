// GitHub-specific Gemini runner. One structured call:
//   evidence (repo metadata + README + curated key files) -> PostDraft
// Mirrors the Instagram/YouTube dedicated paths: detect the URL, gather
// authoritative evidence from the public GitHub API, structure it into a
// FINDING. Any failure (rate limit, private repo, network) propagates so the
// caller in gemini-runner.ts falls back to the generic url_context path.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  fetchRepoEvidence,
  parseGitHubUrl,
  type RepoEvidence,
} from "@repo/github-ingest";
import { PostDraftSchema } from "@repo/ingest-draft";
import { generateText, Output } from "ai";
import { getAIConfig, getHeavyModel } from "../../lib/ai-config";
import { analysisContractLines } from "../analysis-contract";
import { type PostDraft, toGeminiOutput } from "../gemini-runner";
import { notesLeadLines } from "../prompt-blocks";
import type { GeminiOutput } from "../types";

export type GitHubRunOptions = {
  url: string;
  notes: string;
};

export type GitHubRunResult = {
  output: GeminiOutput;
  evidence: RepoEvidence;
};

// Exported for unit testing — the prompt is the worker's one durable, pure
// transformation of the evidence (the generateText call around it isn't unit
// testable without a live model). Body follows the shared RAW-ANALYSIS
// contract (../analysis-contract.ts); the author's voiceProfile deliberately
// does NOT touch this prompt anymore — voice powers the reflection questions.
export function buildGitHubPrompt(evidence: RepoEvidence, notes: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Today's date: ${today}.`,
    "",
    ...notesLeadLines(notes),
    ...analysisContractLines({
      kindLabel: "a GitHub repository (from the gathered evidence below)",
      lengthHint: "300-1200 words, as long as the evidence warrants",
      breakdownHint:
        "repo-specific deep extraction: the project's purpose and the problem it solves, architecture and how it's built (language/stack), key files/modules and what each does, notable code and design choices, setup/usage, and project health signals (stars, activity, docs quality) where present in the evidence.",
    }),
    "Ground every claim in the evidence below — do not invent features.",
    "",
    `Repository: ${evidence.owner}/${evidence.repo}`,
  ];
  if (evidence.description) {
    lines.push(`Description: ${evidence.description}`);
  }
  if (evidence.primaryLanguage || evidence.languages.length > 0) {
    lines.push(
      `Primary language: ${evidence.primaryLanguage ?? "unknown"}; Languages: ${
        evidence.languages.join(", ") || "unknown"
      }`,
    );
  }
  lines.push(
    `Stars: ${evidence.stars}; License: ${evidence.license ?? "none"}; Topics: ${
      evidence.topics.join(", ") || "none"
    }`,
  );
  if (evidence.pushedAt) {
    lines.push(`Last pushed: ${evidence.pushedAt}`);
  }
  if (evidence.readme) {
    lines.push("", "README:", evidence.readme.trim());
  }
  if (evidence.keyFiles.length > 0) {
    lines.push("", "Key files (path, then content):");
    for (const file of evidence.keyFiles) {
      lines.push(`--- ${file.path} ---`, file.content.trim());
    }
  }
  return lines.join("\n");
}

export async function runGitHubGemini(
  options: GitHubRunOptions,
): Promise<GitHubRunResult | null> {
  const ref = parseGitHubUrl(options.url);
  if (!ref) {
    return null;
  }

  const evidence = await fetchRepoEvidence(ref);

  const config = getAIConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
  // url-derived path → heavy (Pro) tier, matching modelForKind("url").
  const model = google(getHeavyModel());

  const { output } = await generateText({
    model,
    temperature: config.temperature,
    prompt: buildGitHubPrompt(evidence, options.notes),
    output: Output.object({ schema: PostDraftSchema }),
  });

  // Deterministic, collision-resistant slug from the repo identity rather than
  // the model's free-form title.
  const draft: PostDraft = {
    ...output,
    slug: `gh-${evidence.owner}-${evidence.repo}`.toLowerCase(),
  };

  const result = toGeminiOutput(draft, "FINDING", {
    originalUrl: ref.canonicalUrl,
  });
  // Provider provenance + a structured digest the post writer persists as
  // first-class columns (providerId, sourceRecordId, contentDigest) so the UI
  // can render a repo chip without re-fetching GitHub.
  result.frontmatter.provider_id = "github";
  result.frontmatter.source_record_id = `${evidence.owner}/${evidence.repo}`;
  result.frontmatter.content_digest = {
    stars: evidence.stars,
    primaryLanguage: evidence.primaryLanguage,
    languages: evidence.languages,
    topics: evidence.topics,
    license: evidence.license,
    defaultBranch: evidence.defaultBranch,
    pushedAt: evidence.pushedAt,
    htmlUrl: evidence.htmlUrl,
    fileCount: evidence.keyFiles.length,
  } as Record<string, unknown>;

  return { output: result, evidence };
}
