import { getVoiceProfile, listArchiveRequests } from "@repo/db";
import { DateDisplay } from "../../../lib/date-display";
import { requireSession } from "../../../lib/session";
import { RequestArchiveButton } from "./request-archive-button";
import { VoiceSection } from "./voice-section";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Building",
  ready: "Ready",
  failed: "Failed",
  expired: "Expired",
};

export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const requests = await listArchiveRequests(session.user.id);
  const voiceProfile = await getVoiceProfile(session.user.id);
  const now = Date.now();

  return (
    <section className="mx-auto max-w-[820px]">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Section VI — The Record
        </p>
        <h1 className="mt-1 font-display italic text-[40px] leading-[0.95] tracking-[-0.01em] sm:text-[48px]">
          Your Data<span className="text-[var(--color-accent)]">.</span>
        </h1>
      </header>

      <div className="hairline-t mt-7 space-y-4 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Your voice
        </p>
        <VoiceSection initialVoice={voiceProfile ?? ""} />
      </div>

      <div className="hairline-t mt-8 space-y-4 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Data retention
        </p>
        <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
          Your uploaded originals — photos, audio, video, and documents — are
          kept for as long as you keep the post. We don’t auto-delete them on a
          schedule. Deleting a post permanently removes its original files. You
          can request a downloadable archive of all your originals at any time;
          the download link is private to you and expires after seven days.
        </p>
      </div>

      <div className="hairline-t mt-8 space-y-4 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Export an archive
        </p>
        <RequestArchiveButton />
      </div>

      <div className="hairline-t mt-8 space-y-4 pt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Archive history
        </p>
        {requests.length === 0 ? (
          <p className="font-display italic text-[15px] text-[var(--fg-subtle)]">
            No archives requested yet.
          </p>
        ) : (
          <ul className="space-y-0">
            {requests.map((req) => {
              const isReady =
                req.status === "ready" &&
                req.token &&
                (!req.expiresAt || req.expiresAt.getTime() > now);
              return (
                <li
                  key={req.id}
                  className="hairline-b flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                >
                  <span className="font-mono text-[11px] nums-lining text-[var(--fg-muted)]">
                    <DateDisplay value={req.createdAt} variant="date-time" />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
                    {STATUS_LABEL[req.status] ?? req.status}
                    {req.fileCount != null ? ` · ${req.fileCount} items` : ""}
                  </span>
                  {isReady ? (
                    <a
                      href={`/api/app/archive/download?token=${req.token}`}
                      className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      ↓ Download
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-faint)]">
                      {req.status === "ready" ? "Expired" : "—"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
