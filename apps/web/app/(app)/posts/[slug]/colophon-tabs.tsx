"use client";

import Link from "next/link";
import { useState } from "react";
import { DateDisplay } from "../../../../lib/date-display";
import type { DateInput } from "../../../../lib/datetime";
import { PUBLIC_CATALOG_ENABLED } from "../../../../lib/features";
import {
  AssignToProject,
  type ProjectOption,
} from "../../_components/assign-to-project";
import { DeletePostButton } from "./delete-post-button";
import { SaveButton } from "./save-button";
import { ShareButton } from "./share-button";

export interface SourceFile {
  submissionId: string;
  originalFilename: string | null;
}

type TabKey = "details" | "history" | "analytics";

export interface ColophonTag {
  id: string;
  name: string;
  slug: string;
}

export interface ColophonCategory {
  id: string;
  displayName: string;
}

export interface ColophonStats {
  totalViews: number;
  uniqueViewers: number;
}

export interface ColophonPost {
  slug: string;
  sourceType: string;
  providerId: string;
  sourceRecordId: string | null;
  sourceHash: string | null;
  syncStatus: string;
  originalUrl: string | null;
  imageUrl: string | null;
  createdAt: DateInput;
  updatedAt: DateInput;
  lastEdited: DateInput;
  lastSyncedAt: DateInput;
  originalDate: DateInput;
  projectId: string | null;
  tags: ColophonTag[];
  categories: ColophonCategory[];
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "history", label: "History" },
  { key: "analytics", label: "Analytics" },
];

export function ColophonTabs({
  post,
  stats = null,
  initialSaved = false,
  canSave = false,
  projects = [],
  canAssign = false,
  isOwner = false,
  sourceFiles = [],
}: {
  post: ColophonPost;
  stats?: ColophonStats | null;
  initialSaved?: boolean;
  canSave?: boolean;
  projects?: ProjectOption[];
  canAssign?: boolean;
  isOwner?: boolean;
  sourceFiles?: SourceFile[];
}) {
  const [tab, setTab] = useState<TabKey>("details");
  const downloadLinkClass =
    "inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]";

  return (
    <aside className="space-y-7 lg:border-l lg:border-[var(--color-rule)] lg:pl-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--fg-subtle)]">
        Colophon
      </div>

      <div
        role="tablist"
        aria-label="Colophon"
        className="flex items-baseline gap-4 font-mono text-[10px] uppercase tracking-[0.18em]"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`relative pb-1 transition-colors ${
                active
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
              }`}
            >
              {t.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 bottom-0 h-px transition-colors ${
                  active ? "bg-[var(--color-accent)]" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      {tab === "details" ? <DetailsTab post={post} /> : null}
      {tab === "history" ? <HistoryTab post={post} /> : null}
      {tab === "analytics" ? <AnalyticsTab stats={stats} /> : null}

      <div className="rule-emphatic-t space-y-3 pt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
          Actions
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <SaveButton
            slug={post.slug}
            initialSaved={initialSaved}
            canSave={canSave}
          />
          <AssignToProject
            slug={post.slug}
            currentProjectId={post.projectId}
            projects={projects}
            canAssign={canAssign}
          />
          {/* Share copies a public /listing/<slug> link; hidden while the
              public catalog is private (PUBLIC_CATALOG_ENABLED) since non-owners
              would only be bounced to sign-in. */}
          {PUBLIC_CATALOG_ENABLED ? <ShareButton slug={post.slug} /> : null}
          <a
            href={`/api/app/posts/${post.slug}/export?format=json`}
            download
            className="inline-flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-muted)] transition-colors hover:text-[var(--color-accent)]"
          >
            <span aria-hidden="true">↓</span>
            Export
            <span className="text-[var(--fg-faint)]">JSON</span>
          </a>
          <a
            href={`/api/app/posts/${post.slug}/export?format=md`}
            download
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)] transition-colors hover:text-[var(--color-accent)]"
          >
            MD
          </a>
        </div>

        {isOwner ? (
          <div className="space-y-2 pt-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
              Your source files
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href={`/api/app/posts/${post.slug}/notes`}
                download
                className={downloadLinkClass}
              >
                <span aria-hidden="true">↓</span>
                Notes
                <span className="text-[var(--fg-faint)]">MD</span>
              </a>
              {sourceFiles.length === 1 ? (
                <a
                  href={`/api/app/posts/${post.slug}/source`}
                  download
                  className={downloadLinkClass}
                >
                  <span aria-hidden="true">↓</span>
                  Original
                </a>
              ) : null}
              {sourceFiles.length > 1
                ? sourceFiles.map((f, i) => (
                    <a
                      key={f.submissionId}
                      href={`/api/app/posts/${post.slug}/source?submissionId=${f.submissionId}`}
                      download
                      className={downloadLinkClass}
                    >
                      <span aria-hidden="true">↓</span>
                      {f.originalFilename ?? `File ${i + 1}`}
                    </a>
                  ))
                : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
              <DeletePostButton slug={post.slug} />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function DetailsTab({ post }: { post: ColophonPost }) {
  return (
    <div className="space-y-7">
      <Meta label="Slug" value={post.slug} mono />
      <Meta label="Source" value={post.sourceType} mono />
      <Meta label="Provider" value={post.providerId} mono />
      {post.originalUrl ? (
        <Meta
          label="Original"
          value={
            <a
              href={post.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all italic text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
            >
              {post.originalUrl}
            </a>
          }
        />
      ) : null}
      {post.imageUrl ? (
        <Meta
          label="Image"
          value={
            <a
              href={post.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all italic text-[var(--color-accent)] underline underline-offset-4 hover:text-[var(--color-accent-deep)]"
            >
              View source image →
            </a>
          }
        />
      ) : null}
      {post.tags.length > 0 ? (
        <Meta
          label="Tags"
          value={
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {post.tags.map((t, i) => (
                <span key={t.id} className="font-display italic text-[15px]">
                  <Link
                    href={`/catalog?tag=${encodeURIComponent(t.slug)}`}
                    className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  >
                    {t.name}
                  </Link>
                  {i < post.tags.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="ml-2 text-[var(--fg-subtle)]"
                    >
                      ,
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          }
        />
      ) : null}
      {post.categories.length > 0 ? (
        <Meta
          label="Categories"
          value={
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {post.categories.map((c, i) => (
                <span key={c.id} className="font-display italic text-[15px]">
                  {c.displayName}
                  {i < post.categories.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="ml-2 text-[var(--fg-subtle)]"
                    >
                      ,
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          }
        />
      ) : null}
    </div>
  );
}

const SYNC_TONE: Record<string, string> = {
  synced: "text-[var(--fg-muted)]",
  pending: "text-[var(--color-accent)]",
  error: "text-[var(--color-accent)]",
  tombstone: "text-[var(--fg-subtle)] line-through decoration-1",
};

function HistoryTab({ post }: { post: ColophonPost }) {
  const events: { label: string; value: DateInput }[] = [
    { label: "Captured", value: post.createdAt },
    { label: "Originally dated", value: post.originalDate },
    { label: "Last edited", value: post.lastEdited ?? post.updatedAt },
    { label: "Last synced", value: post.lastSyncedAt },
  ].filter((e) => e.value != null);

  return (
    <div className="space-y-5">
      <ol className="leader-dots space-y-0">
        {events.map((e) => (
          <li
            key={e.label}
            className="hairline-b flex items-baseline justify-between gap-3 py-2"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
              {e.label}
            </span>
            <span className="flex-1 translate-y-[-3px] leader-dots-line h-[6px] min-w-[1.5rem]" />
            <DateDisplay
              value={e.value}
              variant="date-time"
              className="font-mono text-[11px] nums-lining text-[var(--fg-muted)]"
            />
          </li>
        ))}
      </ol>

      <dl className="space-y-3">
        <Provenance label="Sync status">
          <span
            className={`font-mono text-[12px] uppercase ${
              SYNC_TONE[post.syncStatus] ?? "text-[var(--fg-muted)]"
            }`}
          >
            {post.syncStatus}
          </span>
        </Provenance>
        {post.sourceRecordId ? (
          <Provenance label="Source record">
            <span className="break-all font-mono text-[12px] text-[var(--fg-muted)]">
              {post.sourceRecordId}
            </span>
          </Provenance>
        ) : null}
        {post.sourceHash ? (
          <Provenance label="Source hash">
            <span
              className="font-mono text-[12px] text-[var(--fg-muted)]"
              title={post.sourceHash}
            >
              {post.sourceHash.slice(0, 12)}…
            </span>
          </Provenance>
        ) : null}
      </dl>
    </div>
  );
}

function AnalyticsTab({ stats }: { stats: ColophonStats | null }) {
  return (
    <div className="space-y-6">
      <Figure label="Views" value={stats ? stats.totalViews : null} accent />
      <Figure label="Unique" value={stats ? stats.uniqueViewers : null} />
      {stats === null ? (
        <p className="font-display italic text-[14px] text-[var(--fg-subtle)]">
          Recording…
        </p>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | null;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {label}
      </p>
      <p
        className={`mt-1 font-display italic leading-none nums-oldstyle ${
          accent
            ? "text-[40px] text-[var(--color-accent)]"
            : "text-[28px] text-[var(--fg)]"
        }`}
      >
        {value === null ? "—" : value.toLocaleString("en-US")}
      </p>
    </div>
  );
}

function Provenance({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--fg-subtle)]">
        {label}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--fg-subtle)]">
        {label}
      </p>
      <div
        className={`mt-1.5 text-[14px] text-[var(--fg)] ${mono ? "font-mono break-all text-[12.5px]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
