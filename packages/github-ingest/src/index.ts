// @repo/github-ingest — recognize a GitHub repo URL and gather "structure +
// key files" evidence from the PUBLIC, UNAUTHENTICATED GitHub API. Shared by the
// web preview endpoint (apps/web /api/app/github/preview) and the worker's
// dedicated GitHub runner, the same way @repo/extraction is shared by the web
// extract endpoint and the worker's url branch.
//
// Budget discipline (see client.ts): exactly three REST calls per repo — meta,
// languages, recursive tree — and all file bytes come from raw.githubusercontent
// (off-budget). Two entry points: fetchRepoPreview (card payload) and
// fetchRepoEvidence (card + README + key-file bytes for the model).
import { fetchRawFile, githubApi } from "./client";
import { type GitTreeEntry, selectKeyFiles } from "./select";
import type { RepoEvidence, RepoKeyFile, RepoPreview } from "./types";
import type { GitHubRepoRef } from "./url";

export { type RepoDigest, readRepoDigest } from "./digest";
export {
  GitHubFetchError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  type RepoEvidence,
  type RepoKeyFile,
  type RepoPreview,
} from "./types";
export { type GitHubRepoRef, isGitHubUrl, parseGitHubUrl } from "./url";

// Caps keep the model input bounded and the (best-effort) raw fetches cheap.
const MAX_KEY_FILES = 8;
const MAX_FILE_BYTES = 24 * 1024;
const README_EXCERPT_CHARS = 800;
const README_MAX_BYTES = 16 * 1024;

type RepoMetaResponse = {
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  license: { name?: string | null; spdx_id?: string | null } | null;
  default_branch: string;
  pushed_at: string | null;
  homepage: string | null;
  html_url: string;
  owner: { avatar_url: string | null } | null;
};

type TreeResponse = {
  tree: GitTreeEntry[];
  truncated: boolean;
};

function licenseLabel(meta: RepoMetaResponse): string | null {
  const l = meta.license;
  if (!l) return null;
  return l.spdx_id && l.spdx_id !== "NOASSERTION"
    ? l.spdx_id
    : (l.name ?? null);
}

// Shared first half of both entry points: the three REST calls + key-file
// selection. Returns the preview plus the resolved README path + branch so
// fetchRepoEvidence can pull the bytes without re-listing the tree.
async function gatherStructure(ref: GitHubRepoRef): Promise<{
  preview: RepoPreview;
  branch: string;
  readmePath: string | null;
  keyFilePaths: string[];
}> {
  const meta = await githubApi<RepoMetaResponse>(
    `/repos/${ref.owner}/${ref.repo}`,
    ref,
  );
  const branch = meta.default_branch || "main";

  const languagesObj = await githubApi<Record<string, number>>(
    `/repos/${ref.owner}/${ref.repo}/languages`,
    ref,
  );
  const languages = Object.entries(languagesObj)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const treeRes = await githubApi<TreeResponse>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    ref,
  );
  const { readmePath, keyFilePaths } = selectKeyFiles(
    treeRes.tree ?? [],
    MAX_KEY_FILES,
  );

  const readmeExcerpt = readmePath
    ? await fetchRawFile(ref, branch, readmePath, README_EXCERPT_CHARS)
    : null;

  const preview: RepoPreview = {
    owner: ref.owner,
    repo: ref.repo,
    ownerAvatarUrl: meta.owner?.avatar_url ?? null,
    description: meta.description,
    stars: meta.stargazers_count ?? 0,
    primaryLanguage: meta.language,
    languages,
    topics: meta.topics ?? [],
    license: licenseLabel(meta),
    defaultBranch: branch,
    pushedAt: meta.pushed_at,
    homepage: meta.homepage && meta.homepage.trim() ? meta.homepage : null,
    htmlUrl: meta.html_url ?? ref.canonicalUrl,
    readmeExcerpt,
    keyFilePaths,
  };

  return { preview, branch, readmePath, keyFilePaths };
}

// Lightweight repo card for the confirm-preview UI. ~3 REST calls + 1 raw fetch.
export async function fetchRepoPreview(
  ref: GitHubRepoRef,
): Promise<RepoPreview> {
  const { preview } = await gatherStructure(ref);
  return preview;
}

// Full evidence for the worker's structuring call: the preview, the (capped)
// README, and the bytes of every selected key file. Same 3 REST calls as the
// preview plus N off-budget raw fetches.
export async function fetchRepoEvidence(
  ref: GitHubRepoRef,
): Promise<RepoEvidence> {
  const { preview, branch, readmePath, keyFilePaths } =
    await gatherStructure(ref);

  const readme = readmePath
    ? await fetchRawFile(ref, branch, readmePath, README_MAX_BYTES)
    : null;

  const keyFiles: RepoKeyFile[] = [];
  for (const path of keyFilePaths) {
    const content = await fetchRawFile(ref, branch, path, MAX_FILE_BYTES);
    if (content) {
      keyFiles.push({ path, bytes: content.length, content });
    }
  }

  return { ...preview, readme, keyFiles };
}
