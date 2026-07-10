// AI-usage / Sirius AI Pro card for the web cockpit. Designed via the Stitch ->
// v0 flow (chat https://v0.app/chat/eIOxMW6X0pq) and adapted to the repo's
// design tokens. Server-safe (no client hooks). Web has no purchase flow —
// purchases happen on iOS via the app — so this is informational: it shows the
// weekly AI-draft budget and points to the app to upgrade.
import type { FC } from "react";

export type AiUsage = {
  used: number;
  limit: number | null; // null = unlimited (Pro)
  remaining: number | null; // null = unlimited
  isPro: boolean;
  resetsAt: string | null; // ISO date; null for Pro
};

function formatResetDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toFraction(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(Math.max(used / limit, 0), 1);
}

const ProSeal: FC = () => (
  <span
    aria-hidden="true"
    className="mt-[2px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center border border-[var(--color-accent)] text-[var(--color-accent)]"
  >
    <svg
      width="10"
      height="8"
      viewBox="0 0 10 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1 4L3.8 7L9 1"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

const Rule: FC = () => (
  <hr
    aria-hidden="true"
    className="w-full border-0 border-t border-[var(--color-rule)]"
  />
);

const FooterNote: FC = () => (
  <p className="font-body text-[12px] leading-[1.55] tracking-[0.01em] text-[var(--fg-faint)]">
    Ingesting is always free.{" "}
    <span className="text-[var(--fg-subtle)]">
      Upgrade in the Lesswhelmed app for unlimited AI-written posts.
    </span>
  </p>
);

const ProState: FC = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-start gap-[10px]">
      <ProSeal />
      <div className="flex flex-col gap-[3px]">
        <p className="font-display text-[15px] leading-[1.3] tracking-[-0.01em] text-[var(--fg)]">
          Sirius&nbsp;AI&nbsp;Pro
        </p>
        <p className="font-body text-[13px] leading-[1.45] text-[var(--fg-muted)]">
          Unlimited AI drafts — write without limits.
        </p>
      </div>
    </div>
    <Rule />
    <FooterNote />
  </div>
);

const MeterState: FC<{
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string | null;
}> = ({ used, limit, remaining, resetsAt }) => {
  const pct = Math.round(toFraction(used, limit) * 100);
  const isExhausted = remaining === 0;
  const resetLabel = resetsAt ? formatResetDate(resetsAt) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-[14px] leading-[1.3] tracking-[-0.005em] text-[var(--fg)]">
          AI Drafts This Week
        </p>
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.22em] tabular-nums text-[var(--fg-muted)]"
        >
          {used}&thinsp;/&thinsp;{limit}
        </span>
      </div>

      <div className="flex flex-col gap-[6px]">
        <div
          role="progressbar"
          aria-label="AI draft usage"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuetext={`${used} of ${limit} AI drafts used`}
          className="relative h-[3px] w-full overflow-hidden border-b border-[var(--color-rule)] bg-[var(--color-paper-raised)]"
        >
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-[var(--color-accent)] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="font-body text-[12.5px] leading-[1.45] text-[var(--fg-muted)]">
          {isExhausted ? (
            <>
              <span className="text-[var(--color-accent-deep)]">
                Out of free AI drafts
              </span>
              {resetLabel ? (
                <span className="text-[var(--fg-subtle)]">
                  {" "}
                  — resets {resetLabel}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="text-[var(--fg)]">
                {remaining} of {limit}
              </span>{" "}
              <span className="text-[var(--fg-muted)]">
                free AI draft{remaining !== 1 ? "s" : ""} left this week
              </span>
              {resetLabel ? (
                <span className="text-[var(--fg-subtle)]">
                  {" "}
                  · resets {resetLabel}
                </span>
              ) : null}
            </>
          )}
        </p>
      </div>

      {isExhausted ? (
        <div className="border-l-[1.5px] border-[var(--color-accent)] py-[2px] pl-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent)]">
            Drafts paused
          </p>
          <p className="mt-[2px] font-body text-[12px] leading-[1.45] text-[var(--fg-muted)]">
            New drafts resume when your weekly allotment resets.
          </p>
        </div>
      ) : null}

      <Rule />
      <FooterNote />
    </div>
  );
};

export function AiUsageCard({ usage }: { usage: AiUsage }) {
  const { used, limit, remaining, isPro, resetsAt } = usage;
  const showPro = isPro || limit === null;

  return (
    <article
      aria-label="AI usage"
      className="w-full rounded-sm border border-[var(--color-rule)] bg-[var(--color-paper)] p-5"
    >
      <header className="mb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Lesswhelmed&nbsp;·&nbsp;AI&nbsp;Usage
        </p>
      </header>
      <Rule />
      <div className="mt-4">
        {showPro ? (
          <ProState />
        ) : (
          <MeterState
            used={used}
            limit={limit as number}
            remaining={remaining as number}
            resetsAt={resetsAt}
          />
        )}
      </div>
    </article>
  );
}
