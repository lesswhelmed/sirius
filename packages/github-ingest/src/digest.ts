// The presentation side of the GitHub digest: one pure, dependency-free reader
// that turns a post's (providerId, contentDigest) into the small data the "repo
// chip" renders. Shared by every host (web server + client, mobile) so the three
// surfaces can never disagree on what a GitHub post's chip shows. Kept in its own
// module (and exported at "@repo/github-ingest/digest") so importing it pulls NO
// fetch/client code into a UI bundle.

// The fields the runner writes into Post.contentDigest for github posts (see
// apps/worker/src/pipeline/github/runner.ts). contentDigest is a Prisma `Json`
// column, so this reader treats it as unknown and narrows defensively.
export type RepoDigest = {
  stars: number | null;
  primaryLanguage: string | null;
  license: string | null;
};

// Returns the chip data only for github posts that actually carry at least one
// renderable field; null otherwise (so callers render nothing). Never throws on
// a malformed/legacy digest — every field is individually guarded.
export function readRepoDigest(
  providerId: string | null | undefined,
  contentDigest: unknown
): RepoDigest | null {
  if (providerId !== "github") {
    return null;
  }
  if (typeof contentDigest !== "object" || contentDigest === null) {
    return null;
  }
  const d = contentDigest as Record<string, unknown>;
  const stars = typeof d.stars === "number" ? d.stars : null;
  const primaryLanguage =
    typeof d.primaryLanguage === "string" && d.primaryLanguage.length > 0
      ? d.primaryLanguage
      : null;
  const license =
    typeof d.license === "string" && d.license.length > 0 ? d.license : null;
  if (stars === null && primaryLanguage === null && license === null) {
    return null;
  }
  return { stars, primaryLanguage, license };
}
