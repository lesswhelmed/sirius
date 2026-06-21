import {
  getAiUsage,
  getUserHandle,
  getVoiceProfile,
  listArchiveRequests,
} from "@repo/db";
import Link from "next/link";
import { AiUsageCard } from "../../_chrome/ai-usage-card";
import { DateDisplay } from "../../../lib/date-display";
import { requireSession } from "../../../lib/session";
import { RequestArchiveButton } from "./request-archive-button";
import { SettingsShell, type SettingsSection } from "./settings-shell";
import { ShareHandle } from "./share-handle";
import { VoiceSection } from "./voice-section";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Building",
  ready: "Ready",
  failed: "Failed",
  expired: "Expired",
};

// Small shared header for a settings section's main panel: a mono eyebrow that
// echoes the side-panel nav label, then the display-italic title.
function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="hairline-b pb-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {eyebrow}
      </p>
      <h2 className="mt-1 font-display italic text-[36px] leading-[0.98] tracking-[-0.01em] sm:text-[44px]">
        {title}
        <span className="text-[var(--color-accent)]">.</span>
      </h2>
    </header>
  );
}

export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const [requests, voiceProfile, handle, usage] = await Promise.all([
    listArchiveRequests(session.user.id),
    getVoiceProfile(session.user.id),
    getUserHandle(session.user.id),
    getAiUsage(session.user.id),
  ]);
  const now = Date.now();

  const sections: SettingsSection[] = [
    {
      id: "profile",
      label: "Profile",
      folio: "i",
      blurb: "Your handle and invite link.",
      content: (
        <div className="space-y-7">
          <SectionHeader eyebrow="Profile" title="Your handle" />
          {handle ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                  Handle
                </p>
                <p className="font-display italic text-[28px] leading-none text-[var(--fg)]">
                  @{handle}
                </p>
              </div>
              <div className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
                  Invite a friend
                </p>
                <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
                  Share this link. Anyone signed in can open it and add you as a
                  friend.
                </p>
                <ShareHandle handle={handle} />
              </div>
            </div>
          ) : (
            <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
              You don’t have a handle yet.{" "}
              <Link
                href="/setup-handle"
                className="underline decoration-[var(--color-rule-strong)] underline-offset-4 transition-colors hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]"
              >
                Choose one
              </Link>{" "}
              to get your invite link.
            </p>
          )}
        </div>
      ),
    },
    {
      id: "subscription",
      label: "Subscription",
      folio: "ii",
      blurb: "Your plan and weekly AI-draft usage.",
      content: (
        <div className="space-y-7">
          <SectionHeader eyebrow="Subscription" title="Sirius AI Pro" />
          <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
            Ingesting is always free. The free plan includes a weekly allotment
            of AI-written drafts; Sirius AI Pro removes the cap. Manage your
            subscription in the Sirius app.
          </p>
          <div className="max-w-[420px]">
            <AiUsageCard usage={usage} />
          </div>
        </div>
      ),
    },
    {
      id: "writing-persona",
      label: "Writing Persona",
      folio: "iii",
      blurb: "Shape how your posts are written.",
      content: (
        <div className="space-y-7">
          <SectionHeader eyebrow="Writing Persona" title="Your voice" />
          <VoiceSection initialVoice={voiceProfile ?? ""} />
        </div>
      ),
    },
    {
      id: "data-export",
      label: "Data Export",
      folio: "iv",
      blurb: "Your originals and downloadable archives.",
      content: (
        <div className="space-y-10">
          <SectionHeader eyebrow="Data Export" title="Your data" />

          <div className="space-y-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Data retention
            </p>
            <p className="max-w-[60ch] font-body text-[15px] leading-[1.7] text-[var(--fg-muted)]">
              Your uploaded originals — photos, audio, video, and documents —
              are kept for as long as you keep the post. We don’t auto-delete
              them on a schedule. Deleting a post permanently removes its
              original files. You can request a downloadable archive of all your
              originals at any time; the download link is private to you and
              expires after seven days.
            </p>
          </div>

          <div className="space-y-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Export an archive
            </p>
            <RequestArchiveButton />
          </div>

          <div className="space-y-4">
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
                        {req.fileCount != null
                          ? ` · ${req.fileCount} items`
                          : ""}
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
        </div>
      ),
    },
  ];

  return <SettingsShell sections={sections} />;
}
