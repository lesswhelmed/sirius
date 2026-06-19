// The repo provenance chip — "★ stars · language · license" — shown on posts
// ingested from GitHub (providerId === "github"). One component for every web
// surface (post detail header + catalog cards) so the chip reads identically
// everywhere. Data extraction is the shared, tested readRepoDigest; this is
// render-only. Plain text, never a link: catalog cards already wrap the whole
// row in <Link>, and the post detail surfaces the repo URL in its colophon — so
// nesting an anchor here would be invalid and redundant.
import { readRepoDigest } from "@repo/github-ingest/digest";

export function RepoChip({
  providerId,
  contentDigest,
  className,
}: {
  providerId: string | null | undefined;
  contentDigest: unknown;
  className?: string;
}) {
  const digest = readRepoDigest(providerId, contentDigest);
  if (!digest) {
    return null;
  }
  const parts: string[] = [];
  if (digest.stars !== null) {
    parts.push(`★ ${digest.stars.toLocaleString()}`);
  }
  if (digest.primaryLanguage) {
    parts.push(digest.primaryLanguage);
  }
  if (digest.license) {
    parts.push(digest.license);
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)] ${className ?? ""}`}
      aria-label={`GitHub repository — ${parts.join(", ")}`}
    >
      {parts.map((part, i) => (
        <span key={part} className="inline-flex items-center gap-1.5">
          {i > 0 ? (
            <span aria-hidden="true" className="text-[var(--fg-faint)]">
              ·
            </span>
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}
