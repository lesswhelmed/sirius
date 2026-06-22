// Owner-only "Original capture" section on the post detail page: the raw note
// the user typed at ingest, plus a native <audio> player per retained audio
// original. A server component — native <audio controls> needs no client JS, and
// same-origin requests carry the session cookie so the owner-gated, Range-enabled
// source route streams the file directly. Renders nothing when there's no
// original content, so non-note/non-audio posts show no empty section.
import type { OriginalContent } from "../../../../lib/originals/original-content";

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function OriginalContentSection({
  content,
}: {
  content: OriginalContent;
}) {
  if (content.notes.length === 0 && content.audio.length === 0) {
    return null;
  }
  return (
    <section className="mt-16 rule-emphatic-t pt-6">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
        Original capture
      </h2>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)]">
        As ingested · visible only to you
      </p>

      {content.audio.map((audio) => {
        const meta = [audio.filename, formatBytes(audio.sizeBytes)]
          .filter(Boolean)
          .join(" · ");
        return (
          <figure
            key={audio.submissionId}
            className="mt-6 border border-[var(--color-rule)] bg-[var(--color-paper-raised)] p-4"
          >
            {/* An original audio upload (not authored media), so there is no
                captions track; the figcaption below names the source file. */}
            <audio
              controls
              preload="metadata"
              src={audio.src}
              className="w-full"
            >
              Your browser does not support audio playback.
            </audio>
            <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
              {meta}
            </figcaption>
          </figure>
        );
      })}

      {content.notes.map((note) => (
        <div key={note.submissionId} className="mt-6">
          {note.urls.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {note.urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-[13px] text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {note.text ? (
            <pre className="whitespace-pre-wrap break-words border-l border-[var(--color-rule-emphatic)] pl-4 font-body text-[16px] leading-[1.7] text-[var(--fg)]">
              {note.text}
            </pre>
          ) : null}
        </div>
      ))}
    </section>
  );
}
