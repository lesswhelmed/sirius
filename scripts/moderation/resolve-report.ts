#!/usr/bin/env bun
// Moderation CLI for App Store Guideline 1.2 (UGC) — Part D of
// APP_STORE_SUBMISSION.md §0. Reports of objectionable content email
// SAFETY_ALERT_EMAIL in real time; Apple requires action within 24 HOURS of
// that notification. This CLI is the action tooling: list open reports, take
// down (or fully delete) the offending post, ban the author, resolve the
// report. No web admin UI yet — CLI + email meets the 24h bar.
//
// Run from repo root (bun auto-loads the root .env → DATABASE_URL):
//   bun run scripts/moderation/resolve-report.ts --list
//   bun run scripts/moderation/resolve-report.ts --takedown <postSlug>
//   bun run scripts/moderation/resolve-report.ts --delete <postSlug> --yes
//   bun run scripts/moderation/resolve-report.ts --ban <userIdOrHandle> --reason "…" [--private-all]
//   bun run scripts/moderation/resolve-report.ts --unban <userIdOrHandle>
//   bun run scripts/moderation/resolve-report.ts --resolve <reportId> --resolution uphold|overturn [--as <operator>]
//
// Design notes:
// - `--takedown` sets the post PRIVATE (reversible, evidence preserved). Every
//   feed/search/embedding leg filters on the same visibility predicates
//   (posts.visibilityWhereForViewer / search.searchVisibilityWhere /
//   embeddings.listVisiblePostEmbeddings), so PRIVATE removes it everywhere
//   except the author's own catalog.
// - `--delete` reuses deletePostAndSources (@repo/db post-delete.ts) — the same
//   helper the owner DELETE /api/app/posts/[slug] route calls. The retained-
//   originals disk purge (removeRetainedForSubmission) lives web-side in
//   apps/web/lib/originals/originals-paths.ts and resolves its default root
//   relative to apps/web's cwd, so it is NOT safe to call from a repo-root
//   script; instead the absolute IngestSubmission.retainedFilePath values are
//   printed for manual cleanup. NOTE: ContentReport rows cascade with the post,
//   so a delete also removes the post's open reports (counted + printed).
// - `--ban` sets the better-auth admin columns (banned/banReason/banExpires)
//   directly and deletes the user's session rows so live sessions die now; the
//   admin plugin blocks banned users at sign-in.
import {
  type ContentReportWithContext,
  deletePostAndSources,
  listOpenReports,
  prisma,
  resolveReport,
} from "@repo/db";

// --- args ---------------------------------------------------------------------

type Command =
  | { kind: "list" }
  | { kind: "takedown"; slug: string }
  | { kind: "delete"; slug: string; yes: boolean }
  | { kind: "ban"; userRef: string; reason: string; privateAll: boolean }
  | { kind: "unban"; userRef: string }
  | { kind: "resolve"; reportId: string; resolution: string; as: string };

function usage(exitCode: number): never {
  console.log(`Sirius moderation CLI — App Store Guideline 1.2 (UGC) response tooling.

Apple obligation: act on objectionable-content reports within 24 HOURS of the
notification email (SAFETY_ALERT_EMAIL). The clock runs on the OLDEST open report.

Typical flow:
  1. bun run scripts/moderation/resolve-report.ts --list
  2. bun run scripts/moderation/resolve-report.ts --takedown <postSlug>   (reversible)
     …or for illegal content: --delete <postSlug> --yes                   (permanent)
  3. bun run scripts/moderation/resolve-report.ts --ban <userIdOrHandle> --reason "…"
  4. bun run scripts/moderation/resolve-report.ts --resolve <reportId> --resolution uphold

Commands (exactly one):
  --list                              table of OPEN reports, oldest first
  --takedown <postSlug>               set the post PRIVATE — gone from every feed,
                                      search leg, and embedding scene (reversible:
                                      the author can re-share; evidence preserved)
  --delete <postSlug> --yes           permanently delete the post + its source
                                      submissions (cascades embeddings, comments,
                                      reports). Prints retained-original file
                                      paths for manual disk cleanup. Destructive —
                                      requires --yes.
  --ban <userIdOrHandle> --reason "<text>" [--private-all]
                                      ban the user (better-auth blocks sign-in) and
                                      delete their live sessions. --private-all also
                                      sets every non-PRIVATE post of theirs PRIVATE.
  --unban <userIdOrHandle>            lift a ban
  --resolve <reportId> --resolution uphold|overturn [--as <operator>]
                                      close the report; resolvedById is the --as
                                      value (default "cli")
  --help                              this text

Run from the repo root so bun loads the root .env (DATABASE_URL).`);
  process.exit(exitCode);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(`Run with --help for usage.`);
  process.exit(1);
}

function parseArgs(argv: string[]): Command {
  if (argv.length === 0) usage(0);

  let command: string | null = null;
  let positional: string | null = null;
  let reason: string | null = null;
  let resolution: string | null = null;
  let as = "cli";
  let yes = false;
  let privateAll = false;

  const COMMANDS = new Set([
    "--list",
    "--takedown",
    "--delete",
    "--ban",
    "--unban",
    "--resolve",
  ]);
  const takesValue = new Set([
    "--takedown",
    "--delete",
    "--ban",
    "--unban",
    "--resolve",
  ]);

  const next = (flag: string, i: number): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith("--")) {
      fail(`${flag} needs a value`);
    }
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (COMMANDS.has(arg)) {
      if (command !== null)
        fail(`give exactly one command (${command} and ${arg} both given)`);
      command = arg;
      if (takesValue.has(arg)) positional = next(arg, ++i);
    } else if (arg === "--reason") {
      reason = next(arg, ++i);
    } else if (arg === "--resolution") {
      resolution = next(arg, ++i);
    } else if (arg === "--as") {
      as = next(arg, ++i);
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--private-all") {
      privateAll = true;
    } else {
      fail(`unknown argument "${arg}"`);
    }
  }

  switch (command) {
    case "--list":
      return { kind: "list" };
    case "--takedown":
      return { kind: "takedown", slug: positional as string };
    case "--delete":
      return { kind: "delete", slug: positional as string, yes };
    case "--ban": {
      const trimmed = reason?.trim();
      if (!trimmed) fail(`--ban requires --reason "<text>"`);
      return {
        kind: "ban",
        userRef: positional as string,
        reason: trimmed,
        privateAll,
      };
    }
    case "--unban":
      return { kind: "unban", userRef: positional as string };
    case "--resolve": {
      if (resolution !== "uphold" && resolution !== "overturn") {
        fail(`--resolve requires --resolution uphold|overturn`);
      }
      return {
        kind: "resolve",
        reportId: positional as string,
        resolution,
        as,
      };
    }
    default:
      fail("no command given");
  }
}

// --- helpers --------------------------------------------------------------------

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  handle: true,
  banned: true,
  banReason: true,
} as const;

type ModUser = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  banned: boolean | null;
  banReason: string | null;
};

// Resolve a user by id first, then by handle (both unique columns).
async function resolveUserRef(ref: string): Promise<ModUser> {
  const byId = await prisma.user.findUnique({
    where: { id: ref },
    select: USER_SELECT,
  });
  if (byId) return byId;
  const byHandle = await prisma.user.findUnique({
    where: { handle: ref.trim().toLowerCase() },
    select: USER_SELECT,
  });
  if (byHandle) return byHandle;
  fail(`no user found with id or handle "${ref}"`);
}

function userLabel(u: {
  name: string;
  handle: string | null;
  id: string;
}): string {
  return `${u.name}${u.handle ? ` (@${u.handle})` : ""} [${u.id}]`;
}

function ageHours(createdAt: Date): string {
  return ((Date.now() - createdAt.getTime()) / 3_600_000).toFixed(1);
}

function truncate(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

// --- commands -------------------------------------------------------------------

async function cmdList(): Promise<void> {
  const reports: ContentReportWithContext[] = await listOpenReports();
  if (reports.length === 0) {
    console.log("No open reports. 24h SLA clock is not running.");
    return;
  }

  const rows = reports.map((r) => ({
    id: r.id,
    age: ageHours(r.createdAt),
    reason: r.reason,
    post: `${r.post.slug} — ${truncate(r.post.title, 32)}`,
    author: r.post.submittedBy?.handle
      ? `@${r.post.submittedBy.handle}`
      : (r.post.submittedBy?.name ?? "(unattributed)"),
    reporter: r.reporter.handle ? `@${r.reporter.handle}` : r.reporter.name,
    note: r.note ? truncate(r.note, 40) : "",
  }));

  const headers = {
    id: "REPORT ID",
    age: "AGE(h)",
    reason: "REASON",
    post: "POST",
    author: "AUTHOR",
    reporter: "REPORTER",
    note: "NOTE",
  };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((c) => [
      c,
      Math.max(headers[c].length, ...rows.map((r) => r[c].length)),
    ]),
  ) as Record<keyof typeof headers, number>;

  const line = (r: Record<keyof typeof headers, string>) =>
    cols.map((c) => r[c].padEnd(widths[c])).join("  ");

  console.log(line(headers));
  console.log(cols.map((c) => "-".repeat(widths[c])).join("  "));
  for (const r of rows) console.log(line(r));
  console.log(
    `\n${reports.length} open report(s), oldest first. Reminder: Apple UGC 24h SLA — ` +
      `act within 24 hours of each report's alert email.`,
  );
}

async function cmdTakedown(slug: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      visibility: true,
      submittedBy: { select: { id: true, name: true, handle: true } },
    },
  });
  if (!post) fail(`no post found with slug "${slug}"`);

  console.log(`Post:   ${post.slug} — ${post.title}`);
  console.log(
    `Author: ${post.submittedBy ? userLabel(post.submittedBy) : "(unattributed)"}`,
  );
  console.log(`Before: visibility=${post.visibility}`);

  if (post.visibility === "PRIVATE") {
    console.log("After:  visibility=PRIVATE (already private — nothing to do)");
    return;
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: { visibility: "PRIVATE" },
    select: { visibility: true },
  });
  console.log(`After:  visibility=${updated.visibility}`);
  console.log(
    "Taken down: the post is now owner-only (out of the Friends feed, search, " +
      "and embedding scenes). Reversible — the author can re-share it; use " +
      "--delete for full removal.",
  );
}

async function cmdDelete(slug: string, yes: boolean): Promise<void> {
  if (!yes) {
    fail(
      `--delete is destructive and permanent — re-run with --yes to confirm`,
    );
  }
  const post = await prisma.post.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      submittedById: true,
      submittedBy: { select: { id: true, name: true, handle: true } },
      _count: { select: { reports: true } },
    },
  });
  if (!post) fail(`no post found with slug "${slug}"`);

  console.log(`Deleting post: ${post.slug} — ${post.title}`);
  console.log(
    `Author:        ${post.submittedBy ? userLabel(post.submittedBy) : "(unattributed)"}`,
  );
  if (post._count.reports > 0) {
    console.log(
      `Note: ${post._count.reports} content report(s) on this post will be removed ` +
        `by the delete cascade — --resolve them first if you need the audit row.`,
    );
  }

  let deletedSources: {
    submissionId: string;
    submittedById: string | null;
    retainedFilePath: string | null;
  }[];

  if (post.submittedById !== null) {
    // Reuse the exact owner-delete helper the web DELETE route uses, acting on
    // the author's behalf (it verifies ownerId === submittedById internally).
    const result = await deletePostAndSources(post.slug, post.submittedById);
    if (!result.ok) fail(`delete failed: ${result.reason}`);
    deletedSources = result.deletedSources;
  } else {
    // Unattributed post (bearer-token ingest): deletePostAndSources can't match
    // a null owner, so mirror its two-step transaction inline.
    const sources = await prisma.ingestSubmission.findMany({
      where: { resultPostId: post.id },
      select: { id: true, submittedById: true, retainedFilePath: true },
    });
    await prisma.$transaction([
      prisma.ingestSubmission.deleteMany({ where: { resultPostId: post.id } }),
      prisma.post.delete({ where: { id: post.id } }),
    ]);
    deletedSources = sources.map((s) => ({
      submissionId: s.id,
      submittedById: s.submittedById,
      retainedFilePath: s.retainedFilePath,
    }));
  }

  console.log(
    `Deleted post "${post.slug}" and ${deletedSources.length} source submission(s) ` +
      `(embeddings/comments/saves/reports cascaded).`,
  );

  const retained = deletedSources.filter((s) => s.retainedFilePath !== null);
  if (retained.length === 0) {
    console.log(
      "No retained original files recorded — no disk cleanup needed.",
    );
  } else {
    console.log(
      "\nMANUAL CLEANUP REQUIRED — retained original files were NOT deleted by " +
        "this CLI (the disk purge helper is web-app-scoped). Remove these paths " +
        "(and their parent {userId}/{submissionId} dirs) on the host that runs " +
        "the worker:",
    );
    for (const s of retained) {
      console.log(`  ${s.retainedFilePath}   (submission ${s.submissionId})`);
    }
  }
}

async function cmdBan(
  userRef: string,
  reason: string,
  privateAll: boolean,
): Promise<void> {
  const user = await resolveUserRef(userRef);
  if (user.banned) {
    console.log(
      `Note: ${userLabel(user)} is already banned (reason: ${user.banReason ?? "—"}); ` +
        `updating the ban reason and re-killing sessions.`,
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { banned: true, banReason: reason, banExpires: null },
  });
  const sessions = await prisma.session.deleteMany({
    where: { userId: user.id },
  });
  // Also revoke every API key the user owns. The better-auth apiKey() plugin
  // keys rows to the owning user via `referenceId` (delegate: prisma.apiKey,
  // model ApiKey → table "apikey"); verifyApiKey never checks the owner's
  // `banned` flag, so without this a banned user keeps authenticated access to
  // the MCP corpus service. Delete (not disable) to fully revoke.
  const apiKeys = await prisma.apiKey.deleteMany({
    where: { referenceId: user.id },
  });

  let privated = 0;
  if (privateAll) {
    const res = await prisma.post.updateMany({
      where: { submittedById: user.id, visibility: { not: "PRIVATE" } },
      data: { visibility: "PRIVATE" },
    });
    privated = res.count;
  }

  console.log(`Banned ${userLabel(user)}`);
  console.log(`  Reason:            ${reason}`);
  console.log(`  Expires:           never (permanent until --unban)`);
  console.log(
    `  Sessions revoked:  ${sessions.count} (live sessions die now; sign-in is ` +
      `blocked by the better-auth admin plugin)`,
  );
  console.log(
    `  API keys revoked:  ${apiKeys.count} (deleted; kills MCP/API bearer-key ` +
      `access — verifyApiKey doesn't check the banned flag on its own)`,
  );
  console.log(
    privateAll
      ? `  Posts set PRIVATE: ${privated}`
      : `  Posts: untouched (pass --private-all to also pull their shared posts)`,
  );
}

async function cmdUnban(userRef: string): Promise<void> {
  const user = await resolveUserRef(userRef);
  if (!user.banned) {
    console.log(`${userLabel(user)} is not banned — nothing to do.`);
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { banned: false, banReason: null, banExpires: null },
  });
  console.log(
    `Unbanned ${userLabel(user)} — they can sign in again. Posts they had are ` +
      `left as-is (re-share is theirs to do if any were set PRIVATE).`,
  );
}

async function cmdResolve(
  reportId: string,
  resolution: string,
  as: string,
): Promise<void> {
  const ok = await resolveReport({ reportId, resolvedById: as, resolution });
  if (!ok) {
    fail(
      `no OPEN report with id "${reportId}" (already resolved, or wrong id — ` +
        `check --list)`,
    );
  }
  console.log(
    `Report ${reportId} resolved as "${resolution}" by "${as}". ` +
      `Audit fields (resolvedAt/resolvedById/resolution) are set on the row.`,
  );
}

// --- main -----------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    fail(
      "DATABASE_URL is not set — run from the repo root so bun loads the root .env",
    );
  }
  const cmd = parseArgs(process.argv.slice(2));
  switch (cmd.kind) {
    case "list":
      return cmdList();
    case "takedown":
      return cmdTakedown(cmd.slug);
    case "delete":
      return cmdDelete(cmd.slug, cmd.yes);
    case "ban":
      return cmdBan(cmd.userRef, cmd.reason, cmd.privateAll);
    case "unban":
      return cmdUnban(cmd.userRef);
    case "resolve":
      return cmdResolve(cmd.reportId, cmd.resolution, cmd.as);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
