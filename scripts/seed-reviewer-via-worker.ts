#!/usr/bin/env bun
// Provision an App Store reviewer account and ENQUEUE real ingest jobs that the
// LIVE worker drafts end-to-end — the opposite of scripts/create-reviewer-account.ts,
// which inserts hardcoded finished posts and never touches Gemini. This exists to
// prove the real producer/consumer pipeline works for a fresh reviewer: it writes
// the User + credential exactly like create-reviewer-account.ts, then submits real
// `pending` IngestSubmission rows through the SAME code the web composer uses
// (apps/web/lib/ingest/submit.ts → createSubmission + stageBytes). A running worker
// (apps/worker) then claims each row, runs Gemini (url_context / note / image
// drafting), and writes the Post — no faked content.
//
// This script ONLY enqueues. Start the worker separately to process the queue
// (the chosen "live daemon end-to-end" path):
//   bun run scripts/seed-reviewer-via-worker.ts --password 'StrongPass123'
//   bun apps/worker/src/index.ts            # in another shell — drains the queue
//
// Run from repo root. Reads DATABASE_URL + GEMINI_API_KEY from the root .env
// (the worker reads the same), so by default this targets the LOCAL db.
//   bun run scripts/seed-reviewer-via-worker.ts --reset            # clear this user's content first
//   bun run scripts/seed-reviewer-via-worker.ts --teardown         # remove content, keep user
//   bun run scripts/seed-reviewer-via-worker.ts --teardown --purge-user

import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { hashPassword } from "better-auth/crypto";
import {
  submitImageIngest,
  submitUrlIngest,
} from "../apps/web/lib/ingest/submit";

const DEFAULT_EMAIL = "reviewer@lesswhelmed.com";
const DEFAULT_HANDLE = "sirius-review";
const DEFAULT_NAME = "App Review";
const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

type Args = {
  email: string;
  password?: string;
  handle: string;
  name: string;
  reset: boolean;
  teardown: boolean;
  purgeUser: boolean;
};

function parseArgs(argv: string[]): Args {
  let email = process.env.REVIEWER_EMAIL ?? DEFAULT_EMAIL;
  let password = process.env.REVIEWER_PASSWORD;
  let handle = process.env.REVIEWER_HANDLE ?? DEFAULT_HANDLE;
  let name = process.env.REVIEWER_NAME ?? DEFAULT_NAME;
  let reset = false;
  let teardown = false;
  let purgeUser = false;

  const value = (arg: string, flag: string, next: () => string | undefined) =>
    arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : next();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--reset") reset = true;
    else if (arg === "--teardown") teardown = true;
    else if (arg === "--purge-user") purgeUser = true;
    else if (arg === "--password" || arg.startsWith("--password="))
      password = value(arg, "--password", () => argv[++i]);
    else if (arg === "--email" || arg.startsWith("--email="))
      email = value(arg, "--email", () => argv[++i]) ?? email;
    else if (arg === "--handle" || arg.startsWith("--handle="))
      handle = value(arg, "--handle", () => argv[++i]) ?? handle;
    else if (arg === "--name" || arg.startsWith("--name="))
      name = value(arg, "--name", () => argv[++i]) ?? name;
  }

  return {
    email: email.toLowerCase(),
    password,
    handle: handle.trim().toLowerCase(),
    name,
    reset,
    teardown,
    purgeUser,
  };
}

const log = (level: "info" | "warn" | "error", msg: string, extra?: unknown) =>
  console.log(
    `[seed-via-worker] [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`,
  );

// Same User + credential write as create-reviewer-account.ts so sign-in works at
// once (bypasses email-verify + /setup-handle). Idempotent by email.
async function ensureReviewerUser(args: Args): Promise<{
  userId: string;
  email: string;
  handle: string;
  password: string | null;
}> {
  if (!HANDLE_REGEX.test(args.handle)) {
    console.error(`Invalid handle "${args.handle}" — must match ${HANDLE_REGEX}.`);
    process.exit(1);
  }
  if (args.password != null && args.password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const user = await prisma.user.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      name: args.name,
      emailVerified: true,
      handle: args.handle,
    },
    update: { name: args.name, emailVerified: true, handle: args.handle },
    select: { id: true, email: true, handle: true },
  });

  const existing = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  let generated: string | null = null;
  if (args.password != null || existing == null) {
    const pwd = args.password ?? randomBytes(12).toString("base64url");
    const hashed = await hashPassword(pwd);
    if (existing) {
      await prisma.account.update({
        where: { id: existing.id },
        data: { password: hashed, updatedAt: new Date() },
      });
    } else {
      await prisma.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: hashed,
        },
      });
    }
    generated = args.password ? null : pwd;
  }

  return {
    userId: user.id,
    email: user.email,
    handle: user.handle ?? args.handle,
    password: generated,
  };
}

// Real, safe-for-work source material. NOTE → BLOG, URL → FINDING (worker's
// url_context fetch), IMAGE → SIGHT. The worker forces the type after drafting,
// so these are exactly the three real intake paths.
const NOTE_JOBS: { notes: string }[] = [
  {
    notes:
      "Switched my morning coffee to a slower pour-over. Grind a touch coarser than table salt, bloom with twice the coffee's weight in water for thirty seconds, then pour in slow concentric circles. 18g coffee, 300g water, just off the boil. The whole thing takes three minutes and has quietly become the calmest part of the day.",
  },
  {
    notes:
      "Started a small balcony herb garden with three pots: basil, mint, and thyme. Mint took over its pot within a month. Basil needs more water than I expected in full afternoon sun. Thyme is nearly impossible to kill. Next round I'll move the basil to a deeper pot and give the mint its own corner.",
  },
];

const URL_JOBS: { url: string }[] = [
  { url: "https://en.wikipedia.org/wiki/Sourdough" },
  { url: "https://en.wikipedia.org/wiki/Trail_running" },
];

// One SIGHT image batch from a stable, safe stock photo (deterministic by seed).
const IMAGE_JOBS: { seed: string; notes: string }[] = [
  {
    seed: "ridge-trail-day-hike",
    notes: "A clear morning on the ridge trail — long views and wildflowers.",
  },
];

type Enqueued = { id: string; kind: string; label: string };

async function enqueue(userId: string): Promise<Enqueued[]> {
  const out: Enqueued[] = [];
  const sublog = (lvl: "info" | "warn" | "error", m: string, x?: unknown) =>
    log(lvl, `  submit:${m}`, x);

  for (const job of NOTE_JOBS) {
    const r = await submitUrlIngest({ urls: [], notes: job.notes }, sublog, userId);
    if (!r.ok) {
      log("error", "note submit failed", r);
      continue;
    }
    out.push({ id: r.body.id, kind: r.body.kind, label: job.notes.slice(0, 40) });
  }

  for (const job of URL_JOBS) {
    const r = await submitUrlIngest({ urls: [job.url], notes: "" }, sublog, userId);
    if (!r.ok) {
      log("error", "url submit failed", r);
      continue;
    }
    out.push({ id: r.body.id, kind: r.body.kind, label: job.url });
  }

  for (const job of IMAGE_JOBS) {
    const src = `https://picsum.photos/seed/${job.seed}/1200/900`;
    const res = await fetch(src);
    if (!res.ok) {
      log("error", "image fetch failed", { src, status: res.status });
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const r = await submitImageIngest(
      {
        bytes,
        contentType,
        metadata: {
          batchId: randomUUID(),
          imageIndex: 0,
          totalCount: 1,
          notes: job.notes,
          projectId: "",
          draft: "",
        },
      },
      sublog,
      userId,
    );
    if (!r.ok) {
      log("error", "image submit failed", r);
      continue;
    }
    out.push({ id: r.body.id, kind: r.body.kind, label: `${job.seed} (image)` });
  }

  return out;
}

async function teardown(args: Args): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true, email: true },
  });
  if (!user) {
    log("info", `no user for ${args.email}; nothing to tear down`);
    return;
  }
  const subs = await prisma.ingestSubmission.deleteMany({
    where: { submittedById: user.id },
  });
  // Deleting posts cascades PostEmbedding + PostCategoryMatch; projects cascade
  // ProjectEmbedding. Global topic taxonomy nodes are left in place (invisible
  // without matching posts).
  const posts = await prisma.post.deleteMany({
    where: { submittedById: user.id },
  });
  const projects = await prisma.project.deleteMany({
    where: { ownerId: user.id },
  });
  const aspirations = await prisma.aspiration.deleteMany({
    where: { ownerId: user.id },
  });
  log("info", "torn down", {
    posts: posts.count,
    submissions: subs.count,
    projects: projects.count,
    aspirations: aspirations.count,
  });
  if (args.purgeUser) {
    await prisma.user.delete({ where: { id: user.id } });
    log("info", `deleted reviewer user ${user.email}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.teardown) {
    await teardown(args);
    return;
  }

  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;
  if (!key) {
    console.error(
      "\nGEMINI_API_KEY is required — the worker drafts every submission with it.",
    );
    process.exit(1);
  }

  if (args.reset) {
    log("info", "reset: clearing this reviewer's existing content first");
    await teardown({ ...args, purgeUser: false });
  }

  const reviewer = await ensureReviewerUser(args);
  log("info", "reviewer ready", {
    userId: reviewer.userId,
    email: reviewer.email,
    handle: reviewer.handle,
  });

  log("info", "enqueuing real ingest jobs (pending → worker drafts them)…");
  const items = await enqueue(reviewer.userId);

  console.log("\nEnqueued submissions (status: pending):");
  console.log("--------------------------------------------------");
  for (const it of items) {
    console.log(`  ${it.kind.padEnd(6)} ${it.id}  ${it.label}`);
  }
  console.log("--------------------------------------------------");
  console.log(`  Reviewer email:    ${reviewer.email}`);
  console.log(
    `  Reviewer password: ${reviewer.password ?? "(unchanged — existing/supplied kept)"}`,
  );
  console.log(`  Total enqueued:    ${items.length}`);
  console.log("--------------------------------------------------");
  console.log(
    "\nNow run the worker to drain the queue (live daemon, end-to-end):",
  );
  console.log("  bun apps/worker/src/index.ts");
  console.log(
    "It will claim each pending row, draft via Gemini, and write the Post.",
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
