#!/usr/bin/env bun
// Provision an App Store reviewer account + safe-for-work demo content directly
// in Postgres, so a reviewer can sign in immediately and see a populated Catalog
// and Queue. Bypasses the email-verification + /setup-handle gates by writing the
// User (emailVerified + handle) and a Better Auth credential Account by hand —
// same hash format as scripts/reset-user-password.ts, so sign-in works at once.
//
// Demo posts are inserted as FINISHED Post rows under providerId "demo" (the live
// worker only claims status:"pending" submissions, so these are never touched by
// Gemini). Each post gets a matching "completed" IngestSubmission so the Queue tab
// shows the capture -> draft -> filed flow.
//
// Run from repo root. Reads DATABASE_URL from env (point it at prod):
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --password 'StrongPass123'
//   DATABASE_URL="<prod-url>" REVIEWER_PASSWORD='…' bun run reviewer:seed
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --handle sirius-review --posts 6
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --teardown            # remove demo content
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --teardown --purge-user # also delete the user

import { createHash, randomBytes } from "node:crypto";
import {
  assignPostToProject,
  createAspiration,
  createProject,
  findAspirationByTitle,
  findProjectByTitle,
  type IngestSubmission,
  type Prisma,
  prisma,
} from "@repo/db";
import { hashPassword } from "better-auth/crypto";
// Reuse the worker's REAL auto-org pipeline stage so seeded demo content gets
// the same embeddings + dynamic topic taxonomy + category matches a live ingest
// would produce — no faked vectors. Requires GEMINI_API_KEY (embedding model).
import { buildClassificationInput } from "../apps/worker/src/pipeline/classification/adapters";
import { assignOrg } from "../apps/worker/src/pipeline/classification/assign-org";
import type {
  GeminiOutput,
  PipelineInput,
} from "../apps/worker/src/pipeline/types";

const DEFAULT_EMAIL = "reviewer@lesswhelmed.com";
const DEFAULT_HANDLE = "sirius-review";
const DEFAULT_NAME = "App Review";
const DEMO_PROVIDER_ID = "demo";
const DEMO_HASH_PREFIX = "demo-";
// Mirrors HANDLE_REGEX in packages/db/src/users.ts.
const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

type ParsedArgs = {
  email: string;
  password?: string;
  handle: string;
  name: string;
  posts: number;
  teardown: boolean;
  purgeUser: boolean;
  scene: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  let email = process.env.REVIEWER_EMAIL ?? DEFAULT_EMAIL;
  let password = process.env.REVIEWER_PASSWORD;
  let handle = process.env.REVIEWER_HANDLE ?? DEFAULT_HANDLE;
  let name = process.env.REVIEWER_NAME ?? DEFAULT_NAME;
  let posts = 6;
  let teardown = false;
  let purgeUser = false;
  let scene = true;

  const takeValue = (
    arg: string,
    inline: string,
    next: () => string | undefined,
  ) => (arg.startsWith(`${inline}=`) ? arg.slice(inline.length + 1) : next());

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--teardown") {
      teardown = true;
    } else if (arg === "--purge-user") {
      purgeUser = true;
    } else if (arg === "--no-scene") {
      scene = false;
    } else if (arg === "--password" || arg.startsWith("--password=")) {
      password = takeValue(arg, "--password", () => argv[++i]);
    } else if (arg === "--email" || arg.startsWith("--email=")) {
      email = takeValue(arg, "--email", () => argv[++i]) ?? email;
    } else if (arg === "--handle" || arg.startsWith("--handle=")) {
      handle = takeValue(arg, "--handle", () => argv[++i]) ?? handle;
    } else if (arg === "--name" || arg.startsWith("--name=")) {
      name = takeValue(arg, "--name", () => argv[++i]) ?? name;
    } else if (arg === "--posts" || arg.startsWith("--posts=")) {
      const raw = takeValue(arg, "--posts", () => argv[++i]);
      const n = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n >= 0) posts = n;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    }
  }

  return {
    email: email.toLowerCase(),
    password,
    handle: handle.trim().toLowerCase(),
    name,
    posts,
    teardown,
    purgeUser,
    scene,
  };
}

function usage(): never {
  console.error(
    `Usage: bun run reviewer:seed [options]

  --email <addr>       reviewer email (default ${DEFAULT_EMAIL})
  --password <pwd>     login password (>= 8 chars; generated if omitted)
  --handle <handle>    storefront handle (default ${DEFAULT_HANDLE})
  --name <name>        display name (default "${DEFAULT_NAME}")
  --posts <n>          number of demo posts to seed (default 6)
  --no-scene           skip categories + focus areas (no embeddings; no GEMINI_API_KEY needed)
  --teardown           remove demo posts + submissions + focus areas
  --purge-user         with --teardown, also delete the reviewer user

Env fallbacks: REVIEWER_EMAIL, REVIEWER_PASSWORD, REVIEWER_HANDLE, REVIEWER_NAME.`,
  );
  process.exit(1);
}

type PostType = "BLOG" | "FINDING" | "SIGHT";

interface DemoPost {
  slug: string;
  title: string;
  type: PostType;
  excerpt: string;
  content: string;
  tags: string[];
  categories: { name: string; displayName: string }[];
  originalUrl?: string;
  imageUrl?: string;
}

// Safe-for-work catalog: everyday hobby/productivity content that reads like a
// real personal library. Ordered most-recent-first when seeded.
const DEMO_POSTS: DemoPost[] = [
  {
    slug: "pour-over-coffee-ritual",
    title: "A Slower Pour-Over Ritual",
    type: "BLOG",
    excerpt:
      "Notes on dialing in a calmer morning pour-over: grind, bloom, and a gentler pour.",
    content: `I switched my morning coffee to a slower pour-over and the difference is mostly about attention.

Grind a touch coarser than table salt. Bloom with twice the coffee's weight in water for thirty seconds, then pour in slow concentric circles. The whole thing takes about three minutes and it has quietly become the calmest part of the day.

Ratio I keep coming back to: 18g coffee, 300g water, water just off the boil.`,
    tags: ["coffee", "morning", "ritual"],
    categories: [{ name: "coffee", displayName: "Coffee" }],
  },
  {
    slug: "ridge-trail-day-hike",
    title: "Ridge Trail Day Hike",
    type: "SIGHT",
    excerpt:
      "A clear morning on the ridge trail — wildflowers and a long view.",
    content: `Out early before the heat. The ridge trail opens up after the first mile of switchbacks into a long, easy walk along the spine of the hills.

Wildflowers were out in patches and the valley haze burned off by mid-morning. Packed light: water, a windbreaker, and a sandwich.`,
    tags: ["hiking", "outdoors", "trail"],
    categories: [{ name: "outdoors", displayName: "Outdoors" }],
    imageUrl: "https://picsum.photos/seed/ridge-trail-day-hike/1200/900",
  },
  {
    slug: "deep-work-reading-note",
    title: "Reading Note: Deep Work",
    type: "FINDING",
    excerpt:
      "A short summary of the case for distraction-free focus blocks and how I'm trying it.",
    content: `Saved this article on focused work and pulled out the parts that stuck.

The core claim: the ability to concentrate without distraction is becoming both rare and valuable. The practical takeaway for me is scheduling two protected ninety-minute blocks each morning with notifications off.

Trying it for two weeks before deciding whether it holds up.`,
    tags: ["focus", "productivity", "reading"],
    categories: [{ name: "productivity", displayName: "Productivity" }],
    originalUrl: "https://example.com/articles/deep-work-summary",
  },
  {
    slug: "sourdough-starter-week-one",
    title: "Sourdough Starter: Week One",
    type: "BLOG",
    excerpt: "Keeping a feeding log for a new sourdough starter — day by day.",
    content: `Started a sourdough culture from just flour and water. Keeping a short log so I can see the rhythm.

Day 1–2: nothing much. Day 3: bubbles and a sharp smell. Day 5: doubling reliably within six hours of a feed. Equal parts flour and water by weight, once a day, discard half before each feed.

Next step is a first test loaf once it's predictable.`,
    tags: ["baking", "sourdough", "kitchen"],
    categories: [{ name: "cooking", displayName: "Cooking" }],
  },
  {
    slug: "desk-setup-cable-cleanup",
    title: "Desk Setup: Cable Cleanup",
    type: "SIGHT",
    excerpt:
      "Before-and-after of a tidy desk: under-desk tray and labeled cables.",
    content: `Spent an afternoon cleaning up the desk. The win was an under-desk tray for the power strip and a handful of reusable cable ties.

Labeled each cable at the plug end so swapping a device no longer means crawling underneath. Small thing, but the desk finally feels finished.`,
    tags: ["desk", "setup", "organization"],
    categories: [{ name: "workspace", displayName: "Workspace" }],
    imageUrl: "https://picsum.photos/seed/desk-setup-cable-cleanup/1200/900",
  },
  {
    slug: "city-library-rediscovered",
    title: "Rediscovering the City Library",
    type: "FINDING",
    excerpt:
      "The local library card unlocks e-books, audiobooks, and free museum passes.",
    content: `Came across a thread about everything a public library card includes and went to check ours.

Beyond books: free e-book and audiobook borrowing through an app, a handful of museum day-passes you can reserve, and quiet study rooms you can book online. Signed up the same afternoon.`,
    tags: ["library", "books", "local"],
    categories: [{ name: "reading", displayName: "Reading" }],
    originalUrl: "https://example.com/threads/what-your-library-card-includes",
  },
  {
    slug: "balcony-herb-garden",
    title: "Starting a Balcony Herb Garden",
    type: "BLOG",
    excerpt: "Three pots, full sun, and the herbs that actually survived.",
    content: `Started small with three pots on the balcony: basil, mint, and thyme.

Mint took over its pot within a month (as warned). Basil needs more water than I expected in full afternoon sun. Thyme is the easygoing one — nearly impossible to kill.

Plan for next round: move the basil to a deeper pot and give the mint its own corner.`,
    tags: ["gardening", "herbs", "balcony"],
    categories: [{ name: "gardening", displayName: "Gardening" }],
  },
  {
    slug: "weekly-review-template",
    title: "A Lightweight Weekly Review",
    type: "FINDING",
    excerpt:
      "A five-question Friday review that takes ten minutes and actually sticks.",
    content: `Adopted a tiny weekly-review habit from an article and trimmed it to five questions.

What went well? What stalled? What's the one thing for next week? Anything to hand off? Anything to drop? Ten minutes on Friday afternoon and the next week starts with a clear head.`,
    tags: ["productivity", "review", "habits"],
    categories: [{ name: "productivity", displayName: "Productivity" }],
    originalUrl: "https://example.com/notes/lightweight-weekly-review",
  },
];

function submissionKindFor(type: PostType): "note" | "url" | "image" {
  if (type === "FINDING") return "url";
  if (type === "SIGHT") return "image";
  return "note";
}

function submissionPayloadFor(post: DemoPost): Prisma.InputJsonValue {
  if (post.type === "FINDING") {
    return { urls: post.originalUrl ? [post.originalUrl] : [], notes: "" };
  }
  if (post.type === "SIGHT") {
    return { notes: post.excerpt, contentType: "image/jpeg", extension: "jpg" };
  }
  return { notes: post.content.slice(0, 280) };
}

async function ensureReviewerUser(args: ParsedArgs): Promise<{
  userId: string;
  email: string;
  handle: string;
  password: string | null;
}> {
  if (!HANDLE_REGEX.test(args.handle)) {
    console.error(
      `Invalid handle "${args.handle}" — must match ${HANDLE_REGEX} (lowercase, 3–30 chars).`,
    );
    process.exit(1);
  }

  const supplied = args.password;
  if (supplied != null && supplied.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  // Upsert by email — never creates a duplicate user on re-run.
  const user = await prisma.user.upsert({
    where: { email: args.email },
    create: {
      email: args.email,
      name: args.name,
      emailVerified: true,
      handle: args.handle,
    },
    update: {
      name: args.name,
      emailVerified: true,
      handle: args.handle,
    },
    select: { id: true, email: true, handle: true },
  });

  const existing = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });

  // Idempotent: don't churn an existing login on re-run. Set a password only on
  // first creation, or when one is explicitly supplied (an intentional reset).
  let generated: string | null = null;
  if (supplied != null || existing == null) {
    const password = supplied ?? randomBytes(12).toString("base64url");
    const hashed = await hashPassword(password);
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
    generated = supplied ? null : password;
  }

  return {
    userId: user.id,
    email: user.email,
    handle: user.handle ?? args.handle,
    password: generated,
  };
}

// One seeded post + the submission that "produced" it, kept so the scene step
// can run each through the worker pipeline (assignOrg needs the submission).
type SeededItem = {
  postId: string;
  slug: string;
  submission: IngestSubmission;
  demo: DemoPost;
};

async function seedDemoContent(
  userId: string,
  count: number,
): Promise<SeededItem[]> {
  const selected = DEMO_POSTS.slice(0, count);
  const now = Date.now();
  const items: SeededItem[] = [];

  for (let i = 0; i < selected.length; i++) {
    const post = selected[i];
    if (!post) continue;
    // Stagger createdAt so the catalog/queue ordering looks natural.
    const createdAt = new Date(now - i * 36 * 60 * 60 * 1000);
    const fileHash = createHash("sha256")
      .update(`${post.slug}:${post.content}`)
      .digest("hex");

    const tagConnects = post.tags.map((name) => ({
      where: { name },
      create: { name, slug: name.replace(/\s+/g, "-").toLowerCase() },
    }));
    const categoryConnects = post.categories.map((cat) => ({
      where: { name: cat.name },
      create: {
        name: cat.name,
        displayName: cat.displayName,
        slug: cat.name.replace(/\s+/g, "-").toLowerCase(),
      },
    }));

    const baseFields = {
      title: post.title,
      content: post.content,
      excerpt: post.excerpt,
      type: post.type,
      status: "PUBLISHED" as const,
      published: true,
      filePath: `db://demo/${post.slug}`,
      fileHash,
      originalUrl: post.originalUrl ?? null,
      imageUrl: post.imageUrl ?? null,
      sourceType: "ingest",
      providerId: DEMO_PROVIDER_ID,
      sourceRecordId: post.slug,
      syncStatus: "synced",
      lastSyncedAt: createdAt,
      submittedById: userId,
    };

    const created = await prisma.post.upsert({
      where: { slug: post.slug },
      create: {
        slug: post.slug,
        createdAt,
        ...baseFields,
        tags: { connectOrCreate: tagConnects },
        categories: { connectOrCreate: categoryConnects },
      },
      update: {
        ...baseFields,
        tags: { connectOrCreate: tagConnects },
        categories: { connectOrCreate: categoryConnects },
      },
      select: { id: true, slug: true },
    });

    const contentHash = `${DEMO_HASH_PREFIX}${post.slug}`;
    const submissionData = {
      kind: submissionKindFor(post.type),
      payload: submissionPayloadFor(post),
      status: "completed",
      submittedById: userId,
      resultPostId: created.id,
      resultPostSlug: created.slug,
      startedAt: createdAt,
      completedAt: createdAt,
      ...(post.type === "SIGHT"
        ? {
            batchId: `${DEMO_HASH_PREFIX}${post.slug}`,
            imageIndex: 0,
            totalCount: 1,
          }
        : {}),
    };

    const submission = await prisma.ingestSubmission.upsert({
      where: { contentHash },
      create: { contentHash, ...submissionData },
      update: submissionData,
    });

    items.push({
      postId: created.id,
      slug: created.slug,
      submission,
      demo: post,
    });
  }

  return items;
}

// Curated focus areas (Projects) grouping the demo posts, so the reviewer's Tree
// shows a few populated areas instead of one project per post. Any focus area
// with at least one seeded post this run is created.
const FOCUS_AREAS: { title: string; description: string; slugs: string[] }[] = [
  {
    title: "Home & Garden",
    description:
      "Everyday rituals around the home — a slower coffee, sourdough, and a balcony herb garden.",
    slugs: [
      "pour-over-coffee-ritual",
      "sourdough-starter-week-one",
      "balcony-herb-garden",
    ],
  },
  {
    title: "Outside & Workspace",
    description: "Time outdoors and a calmer, tidier desk setup.",
    slugs: ["ridge-trail-day-hike", "desk-setup-cable-cleanup"],
  },
  {
    title: "Focus & Reading",
    description:
      "Deep work, a lightweight weekly review, and rediscovering the public library.",
    slugs: [
      "deep-work-reading-note",
      "weekly-review-template",
      "city-library-rediscovered",
    ],
  },
];

// Give the seeded posts real categories + focus areas by running each one
// through the worker's actual auto-org stage (assignOrg). assignOrg embeds the
// content, grows the dynamic topic taxonomy, and writes PostCategoryMatch rows;
// because we pre-assign a curated Project, it takes the scoped path and keeps
// that focus area (mints nothing). Idempotent: aspiration/projects are
// found-or-created by title, and every assignOrg write is an upsert/replace.
// Needs GEMINI_API_KEY (embedding model). Mirrors a real signed-in ingest.
async function seedScene(ownerId: string, items: SeededItem[]): Promise<void> {
  if (items.length === 0) return;

  const aspirationTitle = "Personal";
  const aspiration =
    (await findAspirationByTitle(ownerId, aspirationTitle)) ??
    (await createAspiration({
      ownerId,
      title: aspirationTitle,
      description: "Demo focus areas for App Store review.",
      metadata: { demo: true },
    }));

  // Find-or-create a Project per focus area that has a seeded post this run.
  const seededSlugs = new Set(items.map((i) => i.slug));
  const projectIdByTitle = new Map<string, string>();
  const projectTitleBySlug = new Map<string, string>();
  for (const fa of FOCUS_AREAS) {
    const present = fa.slugs.filter((s) => seededSlugs.has(s));
    if (present.length === 0) continue;
    let projectId = (await findProjectByTitle(ownerId, fa.title))?.id;
    if (!projectId) {
      const created = await createProject({
        ownerId,
        title: fa.title,
        description: fa.description,
        aspirationId: aspiration.id,
        metadata: { demo: true },
      });
      if (!created.ok) {
        console.warn(`  ! skipped focus area "${fa.title}": ${created.reason}`);
        continue;
      }
      projectId = created.project.id;
    }
    projectIdByTitle.set(fa.title, projectId);
    for (const s of present) projectTitleBySlug.set(s, fa.title);
  }

  let categorized = 0;
  for (const item of items) {
    const faTitle = projectTitleBySlug.get(item.slug) ?? null;
    const projectId = faTitle ? (projectIdByTitle.get(faTitle) ?? null) : null;

    // Pre-assign the curated focus area so assignOrg's scoped path keeps it.
    if (projectId) {
      await assignPostToProject(ownerId, item.postId, projectId);
    }

    const parsed: GeminiOutput = {
      slug: item.demo.slug,
      title: item.demo.title,
      type: item.demo.type,
      body: item.demo.content,
      frontmatter: {
        tags: item.demo.tags,
        categories: item.demo.categories.map((c) => c.name),
        excerpt: item.demo.excerpt,
      },
      rawMdx: "",
    };
    const input: PipelineInput = {
      kind: "note",
      submission: item.submission,
      notes: item.demo.excerpt,
      submittedById: ownerId,
      projectId,
    };
    const classificationInput = buildClassificationInput(input, parsed);
    const result = await assignOrg({
      input,
      postId: item.postId,
      classificationInput,
    });
    if (result.categoryMatchCount > 0) categorized++;
    console.log(
      `  • ${item.slug} → ${faTitle ?? "(no focus area)"} · ${result.categoryMatchCount} categor${result.categoryMatchCount === 1 ? "y" : "ies"}`,
    );
  }

  console.log(
    `Scene seeded: ${projectIdByTitle.size} focus area(s); ${categorized}/${items.length} posts categorized.`,
  );
}

async function teardown(args: ParsedArgs): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: args.email },
    select: { id: true, email: true },
  });

  if (!user) {
    console.log(`No user found for ${args.email}; nothing to tear down.`);
    return;
  }

  const subs = await prisma.ingestSubmission.deleteMany({
    where: {
      submittedById: user.id,
      contentHash: { startsWith: DEMO_HASH_PREFIX },
    },
  });
  // Deleting posts cascades their PostEmbedding + PostCategoryMatch rows;
  // deleting projects cascades their ProjectEmbedding. (Dynamic CategoryEmbedding
  // taxonomy nodes are global and left in place — with no matching posts they're
  // simply invisible in any scene.)
  const posts = await prisma.post.deleteMany({
    where: { submittedById: user.id, providerId: DEMO_PROVIDER_ID },
  });
  const projects = await prisma.project.deleteMany({
    where: { ownerId: user.id },
  });
  const aspirations = await prisma.aspiration.deleteMany({
    where: { ownerId: user.id },
  });
  console.log(
    `Removed ${posts.count} demo post(s), ${subs.count} submission(s), ` +
      `${projects.count} focus area(s), ${aspirations.count} aspiration(s).`,
  );

  if (args.purgeUser) {
    // Sessions + accounts cascade on user delete (onDelete: Cascade).
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`Deleted reviewer user ${user.email} (${user.id}).`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.teardown) {
    await teardown(args);
    return;
  }

  const reviewer = await ensureReviewerUser(args);
  const items = await seedDemoContent(reviewer.userId, args.posts);

  if (args.scene) {
    const key =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;
    if (!key) {
      console.error(
        "\nScene step needs GEMINI_API_KEY (the embedding model) to seed categories + focus areas.\n" +
          "Set it (the same Gemini key the worker uses), or pass --no-scene to skip.",
      );
      process.exit(1);
    }
    console.log(
      "\nSeeding categories + focus areas through the worker pipeline…",
    );
    await seedScene(reviewer.userId, items);
  }

  console.log("\nApp Store reviewer account ready:");
  console.log("--------------------------------------------------");
  console.log(`  Email:    ${reviewer.email}`);
  console.log(
    `  Password: ${reviewer.password ?? "(unchanged — existing/supplied password kept)"}`,
  );
  console.log(`  Handle:   ${reviewer.handle}`);
  console.log(`  User ID:  ${reviewer.userId}`);
  console.log(`  Demo posts seeded: ${items.length}`);
  console.log(
    `  Categories + focus areas: ${args.scene ? "yes (via worker pipeline)" : "skipped (--no-scene)"}`,
  );
  console.log("--------------------------------------------------");
  if (reviewer.password) {
    console.log("Save the password now — it is not stored anywhere else.");
  }
  console.log(
    "Paste the email + password into App Store Connect > App Review Information.",
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
