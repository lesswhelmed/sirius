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
// Demo FRIENDS are seeded through the LIVE friend-request endpoints over HTTP —
// NOT by writing friendship rows directly — so the data is exactly what a real
// user-to-user request+accept produces (same validation, same sendFriendRequest /
// acceptFriendRequest helpers, same ordered-pair + acceptedAt). Each demo friend
// also gets their OWN posts (FRIEND_CORPORA) seeded through the SAME per-user
// seeder the reviewer uses (seedUserWorld) — their FRIENDS posts populate the
// reviewer's Friends feed + cross-account search, so the reviewer sees a real
// shared stream, not an empty feed. >5 friends are seeded so
// the reviewer's Friends list shows its search + sort toolbar (gated at
// friends.length > 5 in apps/web/app/(app)/friends/friends-list.tsx), with a mix
// of avatar-image and image-less identities so both the <Image> avatar and the
// monogram fallback render. This needs the web app reachable (--web-url / WEB_URL,
// default http://localhost:3000 — a dev-trusted origin) AND a known reviewer
// password (so the script can sign in as the reviewer to send the requests); on a
// re-run of an existing account without --password it is skipped with a notice.
// The two endpoints it drives carry a back-reference to this script:
//   apps/web/app/api/app/friends/requests/route.ts            (POST: send)
//   apps/web/app/api/app/friends/requests/[userId]/route.ts   (POST: accept)
//
// Run from repo root. Reads DATABASE_URL from env (point it at prod):
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --password 'StrongPass123'
//   DATABASE_URL="<prod-url>" REVIEWER_PASSWORD='…' bun run reviewer:seed
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --handle sirius-review --posts 6
//   DATABASE_URL="<prod-url>" WEB_URL="https://lesswhelmed.com" bun run reviewer:seed --password '…'
//   bun run reviewer:seed --no-friends            # skip the friends step
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --teardown            # remove demo content
//   DATABASE_URL="<prod-url>" bun run reviewer:seed --teardown --purge-user # also delete the user + demo friends

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
// Default web origin the friends step posts to. localhost:3000 is the pinned dev
// port AND a better-auth dev-trusted origin (packages/auth/src/index.ts), so a
// local run authenticates with no cert/origin friction. Point it at prod with
// --web-url / WEB_URL when seeding the live reviewer account.
const DEFAULT_WEB_URL =
  process.env.WEB_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
// Demo friend identities live under this email domain so teardown --purge-user
// can find and remove exactly the accounts this script created.
const FRIEND_EMAIL_DOMAIN = "friend.demo";
// Mirrors HANDLE_REGEX in packages/db/src/users.ts.
const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

// The reviewer's demo friends. >5 so the Friends list's search + sort toolbar
// renders (gated at friends.length > 5). The first four carry DiceBear avatar
// images (remote URLs → next/image `unoptimized` branch, the realistic
// OAuth/Gravatar case); the rest are image-less so the serif monogram fallback
// is exercised in the same list. All are throwaway demo identities.
const DEMO_FRIENDS: { handle: string; name: string; image: string | null }[] = [
  { handle: "ava-rivers", name: "Ava Rivers" },
  { handle: "noah-fields", name: "Noah Fields" },
  { handle: "mira-quinn", name: "Mira Quinn" },
  { handle: "leo-marsh", name: "Leo Marsh" },
  { handle: "sana-okafor", name: "Sana Okafor", image: null },
  { handle: "theo-lindqvist", name: "Theo Lindqvist", image: null },
  { handle: "iris-nakamura", name: "Iris Nakamura", image: null },
].map((f, i) => ({
  ...f,
  // First four get a deterministic initials avatar; the rest stay null.
  image:
    i < 4
      ? `https://api.dicebear.com/9.x/initials/png?seed=${encodeURIComponent(
          f.name,
        )}&radius=50&backgroundColor=8b2e2e,1f2a44,3a5a40&textColor=f5f0e6`
      : null,
}));

type ParsedArgs = {
  email: string;
  password?: string;
  handle: string;
  name: string;
  posts: number;
  teardown: boolean;
  purgeUser: boolean;
  scene: boolean;
  friends: boolean;
  resetTerms: boolean;
  armTermsOnly: boolean;
  webUrl: string;
};

function parseArgs(argv: string[]): ParsedArgs {
  let email = process.env.REVIEWER_EMAIL ?? DEFAULT_EMAIL;
  let password = process.env.REVIEWER_PASSWORD;
  let handle = process.env.REVIEWER_HANDLE ?? DEFAULT_HANDLE;
  let name = process.env.REVIEWER_NAME ?? DEFAULT_NAME;
  // Seed the full demo library by default so the Catalog + Explore (taxonomy/map)
  // look populated for App Review. Override with --posts N for a smaller set.
  let posts = DEMO_POSTS.length;
  let teardown = false;
  let purgeUser = false;
  let scene = true;
  let friends = true;
  // App Store 1.2 (UGC): App Review must experience the one-time Terms
  // acceptance gate on sign-in, so re-seeding nulls termsAcceptedAt by default
  // (the sign-up databaseHook in packages/auth stamps it at creation).
  let resetTerms = true;
  let armTermsOnly = false;
  let webUrl = DEFAULT_WEB_URL;

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
    } else if (arg === "--no-friends") {
      friends = false;
    } else if (arg === "--keep-terms") {
      resetTerms = false;
    } else if (arg === "--arm-terms-only") {
      armTermsOnly = true;
    } else if (arg === "--web-url" || arg.startsWith("--web-url=")) {
      webUrl = takeValue(arg, "--web-url", () => argv[++i]) ?? webUrl;
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
    friends,
    resetTerms,
    armTermsOnly,
    webUrl: webUrl.replace(/\/+$/, ""),
  };
}

function usage(): never {
  console.error(
    `Usage: bun run reviewer:seed [options]

  --email <addr>       reviewer email (default ${DEFAULT_EMAIL})
  --password <pwd>     login password (>= 8 chars; generated if omitted)
  --handle <handle>    storefront handle (default ${DEFAULT_HANDLE})
  --name <name>        display name (default "${DEFAULT_NAME}")
  --posts <n>          number of demo posts to seed (default: all)
  --no-scene           skip categories + focus areas (no embeddings; no GEMINI_API_KEY needed)
  --no-friends         skip seeding the reviewer's demo friends
  --keep-terms         don't null the reviewer's termsAcceptedAt (default: reset so
                       App Review sees the one-time Terms acceptance gate)
  --arm-terms-only     ONLY re-arm the terms gate for the existing reviewer (null
                       termsAcceptedAt) and exit — no seeding. Used by the App Store
                       screenshot script after captures consume the gate.
  --web-url <url>      web origin for the friends step (default ${DEFAULT_WEB_URL})
  --teardown           remove demo posts + submissions + focus areas
  --purge-user         with --teardown, also delete the reviewer user + demo friends

Env fallbacks: REVIEWER_EMAIL, REVIEWER_PASSWORD, REVIEWER_HANDLE, REVIEWER_NAME, WEB_URL.`,
  );
  process.exit(1);
}

type PostType = "BLOG" | "FINDING" | "SIGHT";
// Mirrors the PostVisibility enum in packages/db/prisma/schema.prisma. Demo posts
// default to PRIVATE (owner-only, catalog-only). FRIENDS is what actually lights
// up the reviewer's Friends feed + curated search across accounts; PUBLIC only
// surfaces once PUBLIC_CATALOG_ENABLED is flipped on (apps/web/lib/features.ts),
// so we lean on FRIENDS for the live demo and keep PUBLIC for schema coverage.
type PostVisibility = "PRIVATE" | "FRIENDS" | "GROUP" | "PUBLIC";

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
  // Omitted → PRIVATE (owner-only). Set FRIENDS on a post to put it in the feed.
  visibility?: PostVisibility;
}

interface FocusArea {
  title: string;
  description: string;
  slugs: string[];
}

// The full set of demo content for one user: the posts, their focus-area grouping
// (for the Tree/Observatory), and the aspiration they hang under. The reviewer
// and every demo friend are each seeded from one of these through the SINGLE
// per-user seeder (seedUserWorld), so there is no parallel post-creation path.
interface DemoCorpus {
  posts: DemoPost[];
  focusAreas: FocusArea[];
  aspirationTitle: string;
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
    visibility: "PUBLIC",
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
    visibility: "FRIENDS",
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
  {
    slug: "morning-run-river-loop",
    title: "Morning Run: The River Loop",
    type: "SIGHT",
    excerpt: "Five easy miles along the river before the city wakes up.",
    content: `Out the door by six for the river loop. The path is flat and quiet that early — a few other runners, a rowing crew on the water, mist coming off the surface.

Kept it easy: five miles at a conversational pace, no watch-staring. The bridge at the turnaround is the reward, the whole skyline catching the first light.`,
    tags: ["running", "fitness", "morning"],
    categories: [{ name: "fitness", displayName: "Fitness" }],
    visibility: "FRIENDS",
  },
  {
    slug: "learning-spanish-daily",
    title: "Reading Note: A Daily Language Habit",
    type: "FINDING",
    excerpt:
      "Why fifteen honest minutes a day beats a weekend cram for learning a language.",
    content: `Saved a piece on language learning and kept the one idea that matters: consistency beats intensity.

Fifteen minutes every day — a few flashcards, one short dialogue, a sentence written from memory — compounds faster than a three-hour Sunday session you dread. Streaks are motivating precisely because they're small. I'm two weeks into Spanish this way and it's the first time it has stuck.`,
    tags: ["language", "learning", "habits"],
    categories: [{ name: "learning", displayName: "Learning" }],
    originalUrl: "https://example.com/articles/daily-language-habit",
  },
  {
    slug: "film-photography-first-roll",
    title: "First Roll of Film",
    type: "SIGHT",
    excerpt: "Notes from developing my first roll of 35mm in years.",
    content: `Shot a roll of 35mm on an old rangefinder I found at a flea market. Thirty-six frames, no chimping, no deleting — just look, meter, and trust it.

Got the scans back today. Half are throwaways, but a few have a quality digital never quite gives me: grain, soft highlights, a sense of a single moment chosen carefully. Already loading the next roll.`,
    tags: ["photography", "film", "hobby"],
    categories: [{ name: "photography", displayName: "Photography" }],
  },
  {
    slug: "sunday-jazz-records",
    title: "A Sunday of Jazz Records",
    type: "BLOG",
    excerpt: "Slow Sunday, a stack of records, and a few that stopped me cold.",
    content: `Spent a slow Sunday going through a stack of secondhand jazz records.

Side after side of mid-century hard bop — some forgettable, a few that stopped me mid-sentence. There's a warmth to vinyl that's easy to romanticize and also just true: the small ritual of cleaning the record, dropping the needle, and sitting still for a whole side.`,
    tags: ["music", "jazz", "vinyl"],
    categories: [{ name: "music", displayName: "Music" }],
    visibility: "PUBLIC",
  },
  {
    slug: "budget-envelope-method",
    title: "Reading Note: The Envelope Budget",
    type: "FINDING",
    excerpt:
      "An old-school envelope budget, adapted to a few simple categories.",
    content: `Came across a write-up on the envelope budgeting method and adapted it down to something I'll actually keep.

Four categories instead of twenty: essentials, flexible spending, savings, and a small "guilt-free" bucket. Each gets a fixed amount at the start of the month. When a bucket is empty, it's empty. The friction is the point — it makes every trade-off visible.`,
    tags: ["finance", "budgeting", "money"],
    categories: [{ name: "finance", displayName: "Finance" }],
    originalUrl: "https://example.com/articles/envelope-budget-method",
  },
  {
    slug: "handmade-bookshelf-build",
    title: "Building a Small Bookshelf",
    type: "SIGHT",
    excerpt: "A weekend project: a little oak shelf, hand-finished.",
    content: `Built a small oak bookshelf over the weekend — my first real woodworking project with proper joinery.

Cut the boards, glued up the panel, and finished it with a few coats of hardwax oil. The joints aren't perfect and one shelf has a slight bow, but it holds books and it's mine. There's a particular satisfaction in using something you made.`,
    tags: ["woodworking", "diy", "project"],
    categories: [{ name: "woodworking", displayName: "Woodworking" }],
  },
  {
    slug: "ten-minute-meditation",
    title: "Ten Minutes of Quiet",
    type: "BLOG",
    excerpt: "Starting a small daily meditation habit, and what changed.",
    content: `Started sitting for ten minutes each morning. Nothing fancy — a timer, a cushion, and attention on the breath.

The point isn't to empty my head; it's to notice how full it is and let the noise settle a little. Most days my mind wanders the whole time and that's fine. The change I notice is small but real: a bit more space between a thing happening and my reaction to it.`,
    tags: ["mindfulness", "meditation", "calm"],
    categories: [{ name: "mindfulness", displayName: "Mindfulness" }],
  },
  {
    slug: "city-museum-afternoon",
    title: "An Afternoon at the Museum",
    type: "SIGHT",
    excerpt: "A quiet weekday hour with one gallery and a single painting.",
    content: `Ducked into the city art museum on a quiet weekday afternoon. Skipped the highlights and gave myself one gallery and one rule: really look.

Ended up spending most of the hour with a single landscape — the way the light sits on the hills, the marks the brush left up close. Seeing less, but seeing it properly, turned out to be the better trade.`,
    tags: ["art", "museum", "culture"],
    categories: [{ name: "art", displayName: "Art" }],
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
      // termsAcceptedAt is deliberately NOT touched here — the flag-gated
      // reset at the end of the seed owns it (default on; --keep-terms opts
      // out). Nulling it unconditionally in this upsert would defeat the flag.
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

// --- demo friends (seeded through the live friend-request endpoints) ----------

function friendEmail(handle: string): string {
  return `${handle}@${FRIEND_EMAIL_DOMAIN}`;
}

// Ensure a demo friend user exists with a credential login + verified email +
// handle (+ optional avatar image). Mirrors ensureReviewerUser's pattern, but
// the password is always (re)set to the supplied one so the script can sign in
// as this friend over HTTP to accept the reviewer's request. Idempotent.
async function ensureFriendUser(
  friend: { handle: string; name: string; image: string | null },
  password: string,
): Promise<{ userId: string; email: string; handle: string }> {
  if (!HANDLE_REGEX.test(friend.handle)) {
    throw new Error(`Invalid demo-friend handle "${friend.handle}".`);
  }
  const email = friendEmail(friend.handle);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: friend.name,
      emailVerified: true,
      handle: friend.handle,
      image: friend.image,
    },
    update: {
      name: friend.name,
      emailVerified: true,
      handle: friend.handle,
      image: friend.image,
    },
    select: { id: true, email: true, handle: true },
  });

  const hashed = await hashPassword(password);
  const existing = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { id: true },
  });
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
  return {
    userId: user.id,
    email: user.email,
    handle: user.handle ?? friend.handle,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Better Auth applies a STRICTER built-in rate limit to auth paths like
// /sign-in/email (a few requests per ~10s window) than the global 100/60s, and
// it's enabled in production only. Seeding N friends means 1 reviewer sign-in +
// N friend sign-ins in quick succession, which trips it against prod. So we
// back off and retry on 429, honoring the server's Retry-After / X-Retry-After
// (seconds) when present. Local dev has rate limiting off, so this is a no-op there.
const SIGN_IN_MAX_ATTEMPTS = 6;
const SIGN_IN_DEFAULT_BACKOFF_MS = 12_000;

// Sign in over HTTP and return a Cookie header carrying the session. Origin is
// set to the web base so better-auth's trusted-origin check passes (the default
// http://localhost:3000 is a dev-trusted origin; pass --web-url for prod).
async function httpSignIn(
  webUrl: string,
  email: string,
  password: string,
): Promise<string> {
  for (let attempt = 1; attempt <= SIGN_IN_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${webUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webUrl },
      body: JSON.stringify({ email, password }),
    });

    if (res.status === 429 && attempt < SIGN_IN_MAX_ATTEMPTS) {
      const retryHeader =
        res.headers.get("x-retry-after") ?? res.headers.get("retry-after");
      const retrySec = retryHeader ? Number.parseInt(retryHeader, 10) : NaN;
      const waitMs = Number.isFinite(retrySec)
        ? retrySec * 1000 + 1000
        : SIGN_IN_DEFAULT_BACKOFF_MS;
      console.log(
        `    …rate-limited signing in ${email}; waiting ${Math.ceil(waitMs / 1000)}s (attempt ${attempt}/${SIGN_IN_MAX_ATTEMPTS - 1})`,
      );
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      throw new Error(
        `sign-in failed for ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length === 0) {
      throw new Error(`sign-in for ${email} returned no Set-Cookie`);
    }
    // Keep just the name=value pair of each cookie for the request Cookie header.
    return setCookies.map((c) => c.split(";")[0]).join("; ");
  }
  throw new Error(
    `sign-in for ${email} still rate-limited after ${SIGN_IN_MAX_ATTEMPTS} attempts`,
  );
}

// POST the real "send friend request" endpoint. 201 = sent; 409 = already
// pending/friends (idempotent re-run) — both are success for seeding.
async function httpSendRequest(
  webUrl: string,
  cookie: string,
  handle: string,
): Promise<"sent" | "exists"> {
  const res = await fetch(`${webUrl}/api/app/friends/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webUrl, cookie },
    body: JSON.stringify({ handle }),
  });
  if (res.status === 201) return "sent";
  if (res.status === 409) return "exists";
  throw new Error(
    `send request → @${handle}: ${res.status} ${(await res.text()).slice(0, 200)}`,
  );
}

// POST the real "accept request" endpoint as the recipient. 200 = accepted;
// 404 = nothing pending (already accepted) — idempotent.
async function httpAcceptRequest(
  webUrl: string,
  cookie: string,
  requesterUserId: string,
): Promise<"accepted" | "noop"> {
  const res = await fetch(
    `${webUrl}/api/app/friends/requests/${requesterUserId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: webUrl, cookie },
      body: JSON.stringify({ action: "accept" }),
    },
  );
  if (res.ok) return "accepted";
  if (res.status === 404) return "noop";
  throw new Error(
    `accept from ${requesterUserId}: ${res.status} ${(await res.text()).slice(0, 200)}`,
  );
}

// Seed the reviewer's demo friends by driving the real endpoints: the reviewer
// sends a request to each friend, then each friend signs in and accepts it. The
// resulting ACCEPTED friendships are byte-for-byte what real user traffic
// produces (sendFriendRequest → acceptFriendRequest). Needs the web app running
// and a known reviewer password.
async function seedFriends(
  reviewer: { userId: string; email: string; password: string | null },
  webUrl: string,
  scene: boolean,
): Promise<"seeded" | "skipped"> {
  if (!reviewer.password) {
    console.warn(
      "\nFriends step skipped: the reviewer's password is unknown on this run\n" +
        "(existing account, no --password). Re-run with --password to set a known\n" +
        "password so the script can sign in as the reviewer, or pass --no-friends.",
    );
    return "skipped";
  }

  // Fail fast with a clear message if the web app isn't reachable.
  let reviewerCookie: string;
  try {
    reviewerCookie = await httpSignIn(
      webUrl,
      reviewer.email,
      reviewer.password,
    );
  } catch (err) {
    console.warn(
      `\nFriends step skipped: could not sign in at ${webUrl} ` +
        `(${err instanceof Error ? err.message : String(err)}).\n` +
        "Make sure the web app is running and reachable, then re-run, or pass --no-friends.",
    );
    return "skipped";
  }

  // A prior seed run re-armed the terms gate (termsAcceptedAt = null), and every
  // /api/app/* write the reviewer makes below sits behind it (403 terms-required).
  // Accept through the real endpoint first — idempotent, and the flag-gated reset
  // at the END of the seed re-arms the gate afterward (it runs last for exactly
  // this reason). Demo friends are stamped at sign-up by the auth hook.
  const termsRes = await fetch(`${webUrl}/api/app/account/accept-terms`, {
    method: "POST",
    headers: { origin: webUrl, cookie: reviewerCookie },
  });
  if (!termsRes.ok) {
    console.warn(
      `\nFriends step skipped: could not accept terms as the reviewer ` +
        `(${termsRes.status} ${await termsRes.text().catch(() => "")}).`,
    );
    return "skipped";
  }

  let accepted = 0;
  let posts = 0;
  for (const friend of DEMO_FRIENDS) {
    const fu = await ensureFriendUser(friend, reviewer.password);
    const sent = await httpSendRequest(webUrl, reviewerCookie, fu.handle);
    const friendCookie = await httpSignIn(webUrl, fu.email, reviewer.password);
    const result = await httpAcceptRequest(
      webUrl,
      friendCookie,
      reviewer.userId,
    );
    if (result === "accepted" || sent === "exists") accepted++;
    // Seed this friend's OWN posts through the same per-user seeder the reviewer
    // uses. Their FRIENDS posts populate the reviewer's Friends feed + search;
    // scene (embeddings/categories) runs when enabled — same GEMINI gate.
    const corpus = FRIEND_CORPORA[friend.handle];
    let seededCount = 0;
    if (corpus) {
      const seeded = await seedUserWorld(fu.userId, corpus, { scene });
      seededCount = seeded.length;
      posts += seededCount;
    }
    console.log(
      `  • @${fu.handle} (${friend.image ? "avatar" : "monogram"}): request ${sent}, accept ${result}, ${seededCount} post(s)`,
    );
  }
  console.log(
    `Friends seeded: ${DEMO_FRIENDS.length} demo friend(s) via ${webUrl} ` +
      `(${accepted} accepted/confirmed, ${posts} friend post(s)` +
      `${scene ? " + scene" : ""}).`,
  );
  return "seeded";
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
  posts: DemoPost[],
  count?: number,
): Promise<SeededItem[]> {
  const selected = count == null ? posts : posts.slice(0, count);
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
      // Default PRIVATE (owner-only catalog). FRIENDS/PUBLIC surface the post in
      // the feed/search per visibilityWhereForViewer (packages/db/src/posts.ts).
      visibility: post.visibility ?? "PRIVATE",
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

    // `contentHash` is no longer @unique (migration 20260704120000_ingest_per_submitter_dedup
    // dropped it for PARTITIONED dedup — see packages/db/src/ingest.ts createSubmission), so a
    // unique upsert on it is invalid. Mirror that helper's partition-scoped lookup: these seed
    // rows are always attributed, so dedup on (contentHash, submittedById) and update-or-create
    // by id to stay idempotent across re-seeds.
    const existing = await prisma.ingestSubmission.findFirst({
      where: { contentHash, submittedById: userId },
      select: { id: true },
    });
    const submission = existing
      ? await prisma.ingestSubmission.update({
          where: { id: existing.id },
          data: submissionData,
        })
      : await prisma.ingestSubmission.create({
          data: { contentHash, ...submissionData },
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
const FOCUS_AREAS: FocusArea[] = [
  {
    title: "Home & Kitchen",
    description:
      "Everyday rituals around the home — a slower coffee, sourdough, and a balcony herb garden.",
    slugs: [
      "pour-over-coffee-ritual",
      "sourdough-starter-week-one",
      "balcony-herb-garden",
    ],
  },
  {
    title: "Outside & Body",
    description: "Time outdoors on the trail and an early-morning river run.",
    slugs: ["ridge-trail-day-hike", "morning-run-river-loop"],
  },
  {
    title: "Focus & Money",
    description:
      "Deep work, a weekly review, a daily language habit, and a simple budget.",
    slugs: [
      "deep-work-reading-note",
      "weekly-review-template",
      "learning-spanish-daily",
      "budget-envelope-method",
    ],
  },
  {
    title: "Make & Build",
    description:
      "Hands-on projects — a tidy desk, a handmade bookshelf, and a first roll of film.",
    slugs: [
      "desk-setup-cable-cleanup",
      "handmade-bookshelf-build",
      "film-photography-first-roll",
    ],
  },
  {
    title: "Mind & Culture",
    description:
      "Quieter hours — the library, Sunday records, ten minutes of meditation, and an afternoon at the museum.",
    slugs: [
      "city-library-rediscovered",
      "sunday-jazz-records",
      "ten-minute-meditation",
      "city-museum-afternoon",
    ],
  },
];

// The reviewer's own world: the full demo library above, grouped into the focus
// areas above, under a single "Personal" aspiration. Fed to the same per-user
// seeder every demo friend uses (seedUserWorld) — one source of truth.
const REVIEWER_CORPUS: DemoCorpus = {
  posts: DEMO_POSTS,
  focusAreas: FOCUS_AREAS,
  aspirationTitle: "Personal",
};

// Each demo friend's own small world, keyed by the friend handle in DEMO_FRIENDS.
// Every friend has at least one FRIENDS post so the reviewer's Friends feed +
// cross-account search are populated for real; a couple carry a PUBLIC post for
// schema coverage (invisible until PUBLIC_CATALOG_ENABLED flips — see the
// PostVisibility note above). Slugs are handle-prefixed so they never collide
// with the reviewer's or each other's (Post.slug is globally unique). Safe-for-
// work personal-hobby content that reads like a real acquaintance's library.
const FRIEND_CORPORA: Record<string, DemoCorpus> = {
  "ava-rivers": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "On the Water",
        description: "Early paddles and the kit that makes them easy.",
        slugs: ["ava-rivers-dawn-paddle", "ava-rivers-paddling-kit"],
      },
    ],
    posts: [
      {
        slug: "ava-rivers-dawn-paddle",
        title: "Dawn Paddle on the Lake",
        type: "SIGHT",
        visibility: "FRIENDS",
        excerpt:
          "Glassy water, no wind, and the whole lake to myself before seven.",
        content: `Put in just before sunrise. The lake was dead calm — that rare glassy morning where the paddle barely leaves a ripple.

Kept to the shoreline, watching mist lift off the coves. A heron stood so still I nearly drifted into it. Back at the dock by the time the first motorboats woke up.`,
        tags: ["paddling", "kayak", "outdoors"],
        categories: [{ name: "paddling", displayName: "Paddling" }],
      },
      {
        slug: "ava-rivers-paddling-kit",
        title: "Reading Note: A Minimal Paddling Kit",
        type: "FINDING",
        visibility: "PUBLIC",
        excerpt:
          "The short list of gear that actually earns its place in the boat.",
        content: `Saved a guide on packing light for day trips and trimmed it to what I actually carry.

Dry bag, water, a windbreaker, a whistle, and a small first-aid kit. Everything else is optional. The lesson that stuck: a lighter boat is a safer boat because you paddle it better.`,
        tags: ["gear", "kayak", "outdoors"],
        categories: [{ name: "outdoors", displayName: "Outdoors" }],
        originalUrl: "https://example.com/guides/minimal-paddling-kit",
      },
    ],
  },
  "noah-fields": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "The Home Kitchen",
        description: "Bread on a weeknight and the small skills behind it.",
        slugs: ["noah-fields-weeknight-focaccia", "noah-fields-knife-skills"],
      },
    ],
    posts: [
      {
        slug: "noah-fields-weeknight-focaccia",
        title: "Weeknight Focaccia",
        type: "BLOG",
        visibility: "FRIENDS",
        excerpt:
          "A no-knead focaccia you can start after work and bake before bed.",
        content: `Mixed the dough in five minutes, let it do the work in the fridge overnight, and baked it the next evening.

Dimple it hard with oiled fingers, a good glug of olive oil, flaky salt, and rosemary from the balcony. Twenty minutes later the whole flat smells like a bakery. No kneading, no stand mixer, no fuss.`,
        tags: ["baking", "bread", "kitchen"],
        categories: [{ name: "cooking", displayName: "Cooking" }],
      },
      {
        slug: "noah-fields-knife-skills",
        title: "Reading Note: Better Knife Skills",
        type: "FINDING",
        visibility: "FRIENDS",
        excerpt: "Two small fixes that made prep faster and a lot less scary.",
        content: `Watched a walkthrough on knife technique and kept the two things that mattered.

First: the claw grip — curl your fingertips under so the blade rides your knuckles. Second: let the knife do the cutting, don't force it. Ten minutes of practice on an onion and chopping stopped feeling like a chore.`,
        tags: ["cooking", "technique", "kitchen"],
        categories: [{ name: "cooking", displayName: "Cooking" }],
        originalUrl: "https://example.com/guides/better-knife-skills",
      },
    ],
  },
  "mira-quinn": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "Frames & Places",
        description: "Travel photos and traveling light.",
        slugs: ["mira-quinn-blue-hour", "mira-quinn-one-lens-trip"],
      },
    ],
    posts: [
      {
        slug: "mira-quinn-blue-hour",
        title: "Blue Hour in the Old Town",
        type: "SIGHT",
        visibility: "FRIENDS",
        excerpt:
          "The ten minutes after sunset when the streetlights and the sky match.",
        content: `Stayed out past sunset in the old town and caught the blue hour — that short window when the sky goes deep cobalt and the warm streetlights balance it perfectly.

Rested the camera on a railing for a long exposure. Cobblestones still wet from an earlier shower, one lit café, almost nobody around. The best frame of the whole trip and it took thirty seconds of standing still.`,
        tags: ["photography", "travel", "city"],
        categories: [{ name: "photography", displayName: "Photography" }],
      },
      {
        slug: "mira-quinn-one-lens-trip",
        title: "One Lens for a Whole Trip",
        type: "BLOG",
        visibility: "PUBLIC",
        excerpt:
          "Why I left the zoom at home and shot a week on a single prime.",
        content: `Packed one small 35mm prime and nothing else for a week away.

The constraint turned out to be the point. Instead of fiddling with focal length I moved my feet, and the photos got more deliberate. Lighter bag, fewer decisions, better pictures. I don't think I'll travel with a zoom again.`,
        tags: ["photography", "travel", "minimal"],
        categories: [{ name: "photography", displayName: "Photography" }],
      },
    ],
  },
  "leo-marsh": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "Miles & Motion",
        description: "Training the hills and turning the commute into it.",
        slugs: ["leo-marsh-hill-repeats", "leo-marsh-commute-swap"],
      },
    ],
    posts: [
      {
        slug: "leo-marsh-hill-repeats",
        title: "Learning to Love Hill Repeats",
        type: "BLOG",
        visibility: "FRIENDS",
        excerpt: "The workout I dreaded became the one I look forward to.",
        content: `Started doing hill repeats once a week on the climb behind the house.

The trick was going easier than my ego wanted — steady effort up, spin gently down, repeat six times. Six weeks in and climbs that used to wreck me feel routine. Turns out the workout I dreaded is the one that actually moved the needle.`,
        tags: ["cycling", "fitness", "training"],
        categories: [{ name: "fitness", displayName: "Fitness" }],
      },
      {
        slug: "leo-marsh-commute-swap",
        title: "Reading Note: Bike-Commuting the Easy Way",
        type: "FINDING",
        visibility: "FRIENDS",
        excerpt:
          "How to swap the car for the bike without it feeling like a project.",
        content: `Read a piece on making bike-commuting stick and it reframed the whole thing for me.

The advice that landed: don't try to replace every trip, just the easy ones. Leave a set of clothes at work, keep the bike ready by the door, and start with the days the weather is on your side. Momentum does the rest.`,
        tags: ["cycling", "commute", "habits"],
        categories: [{ name: "fitness", displayName: "Fitness" }],
        originalUrl: "https://example.com/articles/easy-bike-commuting",
      },
    ],
  },
  "sana-okafor": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "The Reading Life",
        description: "Reading more, and getting the books for free.",
        slugs: ["sana-okafor-two-books-week", "sana-okafor-library-holds"],
      },
    ],
    posts: [
      {
        slug: "sana-okafor-two-books-week",
        title: "How I Finally Read Two Books a Week",
        type: "BLOG",
        visibility: "FRIENDS",
        excerpt:
          "Not speed-reading — just carving out the same twenty minutes daily.",
        content: `For years I said I had no time to read. What changed wasn't speed, it was a slot: twenty minutes before bed, phone in the other room.

Two books a week now, mostly because the habit is boringly consistent. Some nights it's five pages, some nights fifty. The streak is what keeps it alive.`,
        tags: ["reading", "books", "habits"],
        categories: [{ name: "reading", displayName: "Reading" }],
      },
      {
        slug: "sana-okafor-library-holds",
        title: "Reading Note: The Art of Library Holds",
        type: "FINDING",
        visibility: "FRIENDS",
        excerpt:
          "Queue the new releases early and they arrive spread out, for free.",
        content: `Came across a tip on using library hold queues and it changed how I get books.

Place holds on new releases the moment they're announced. By the time your turn comes they trickle in a few weeks apart — a steady, free reading list with no impulse buys. My to-read shelf has never been healthier or cheaper.`,
        tags: ["reading", "library", "books"],
        categories: [{ name: "reading", displayName: "Reading" }],
        originalUrl: "https://example.com/notes/library-hold-strategy",
      },
    ],
  },
  "theo-lindqvist": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "Shop Notes",
        description: "Joinery attempts and keeping the tools sharp.",
        slugs: ["theo-lindqvist-first-dovetails", "theo-lindqvist-sharpening"],
      },
    ],
    posts: [
      {
        slug: "theo-lindqvist-first-dovetails",
        title: "My First Hand-Cut Dovetails",
        type: "SIGHT",
        visibility: "FRIENDS",
        excerpt:
          "Wonky, gappy, and completely satisfying — my first real joint.",
        content: `Cut my first set of hand dovetails this weekend. They are, objectively, a mess — gaps I filled, one pin split, angles that wander.

But they hold, and I made them with a saw and a chisel and a lot of patience. Framing the little test piece on the shop wall as a reminder of where the baseline was.`,
        tags: ["woodworking", "diy", "craft"],
        categories: [{ name: "woodworking", displayName: "Woodworking" }],
      },
      {
        slug: "theo-lindqvist-sharpening",
        title: "Reading Note: Keeping Chisels Sharp",
        type: "FINDING",
        visibility: "FRIENDS",
        excerpt:
          "The unglamorous skill that fixed half my woodworking problems.",
        content: `Read a primer on sharpening and finally took it seriously. Turns out most of my bad cuts were dull tools, not bad technique.

A cheap honing guide, two stones, and a strop. Five minutes at the start of each session. A sharp chisel goes through end grain like it isn't there — the difference is night and day.`,
        tags: ["woodworking", "tools", "craft"],
        categories: [{ name: "woodworking", displayName: "Woodworking" }],
        originalUrl: "https://example.com/guides/sharpening-chisels",
      },
    ],
  },
  "iris-nakamura": {
    aspirationTitle: "Personal",
    focusAreas: [
      {
        title: "Green & Steeped",
        description: "Growing the herbs and slowing down over the cup.",
        slugs: ["iris-nakamura-windowsill-tea", "iris-nakamura-slow-cup"],
      },
    ],
    posts: [
      {
        slug: "iris-nakamura-windowsill-tea",
        title: "A Windowsill of Tea Herbs",
        type: "BLOG",
        visibility: "FRIENDS",
        excerpt:
          "Mint, lemon balm, and chamomile — a whole tea garden in three pots.",
        content: `Turned the kitchen windowsill into a tiny tea garden: mint, lemon balm, and a little chamomile.

Mint is the enthusiastic one, lemon balm the reliable one, chamomile the diva that sulks if it dries out. A handful of fresh leaves in hot water beats anything from a box, and the sill smells wonderful when the afternoon sun hits it.`,
        tags: ["gardening", "tea", "herbs"],
        categories: [{ name: "gardening", displayName: "Gardening" }],
      },
      {
        slug: "iris-nakamura-slow-cup",
        title: "The Slow Cup",
        type: "BLOG",
        visibility: "FRIENDS",
        excerpt: "Making the afternoon tea into a small, deliberate pause.",
        content: `Started treating the afternoon cup as a real break instead of something I drink at my desk.

Boil the water, warm the pot, wait the full four minutes without reaching for my phone. It's a small ritual but it resets the day the way a walk does. The tea is better hot and unhurried, and so am I.`,
        tags: ["tea", "ritual", "calm"],
        categories: [{ name: "tea", displayName: "Tea" }],
      },
    ],
  },
};

// Give the seeded posts real categories + focus areas by running each one
// through the worker's actual auto-org stage (assignOrg). assignOrg embeds the
// content, grows the dynamic topic taxonomy, and writes PostCategoryMatch rows;
// because we pre-assign a curated Project, it takes the scoped path and keeps
// that focus area (mints nothing). Idempotent: aspiration/projects are
// found-or-created by title, and every assignOrg write is an upsert/replace.
// Needs GEMINI_API_KEY (embedding model). Mirrors a real signed-in ingest.
async function seedScene(
  ownerId: string,
  items: SeededItem[],
  focusAreas: FocusArea[],
  aspirationTitle: string,
): Promise<void> {
  if (items.length === 0) return;

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
  for (const fa of focusAreas) {
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

// THE single per-user seeder. Given a user id and a corpus, it seeds that user's
// posts + submissions and (when scene is on) runs them through the worker's real
// auto-org stage for embeddings + categories + focus areas. The reviewer and
// every demo friend go through this one path, so demo content is produced
// identically for everyone — one source of truth. Idempotent (all upserts).
async function seedUserWorld(
  userId: string,
  corpus: DemoCorpus,
  opts: { scene: boolean; postLimit?: number },
): Promise<SeededItem[]> {
  const items = await seedDemoContent(userId, corpus.posts, opts.postLimit);
  if (opts.scene) {
    await seedScene(userId, items, corpus.focusAreas, corpus.aspirationTitle);
  }
  return items;
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

  // Demo content lives under BOTH the reviewer and the @friend.demo users now, so
  // clear content for all of them (not just the reviewer) even without
  // --purge-user, matching what the seed step created.
  const friendUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${FRIEND_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ownerIds = [user.id, ...friendUsers.map((f) => f.id)];

  const subs = await prisma.ingestSubmission.deleteMany({
    where: {
      submittedById: { in: ownerIds },
      contentHash: { startsWith: DEMO_HASH_PREFIX },
    },
  });
  // Deleting posts cascades their PostEmbedding + PostCategoryMatch rows;
  // deleting projects cascades their ProjectEmbedding. (Dynamic CategoryEmbedding
  // taxonomy nodes are global and left in place — with no matching posts they're
  // simply invisible in any scene.)
  const posts = await prisma.post.deleteMany({
    where: { submittedById: { in: ownerIds }, providerId: DEMO_PROVIDER_ID },
  });
  const projects = await prisma.project.deleteMany({
    where: { ownerId: { in: ownerIds } },
  });
  const aspirations = await prisma.aspiration.deleteMany({
    where: { ownerId: { in: ownerIds } },
  });
  console.log(
    `Removed ${posts.count} demo post(s), ${subs.count} submission(s), ` +
      `${projects.count} focus area(s), ${aspirations.count} aspiration(s) ` +
      `across ${ownerIds.length} demo user(s).`,
  );

  if (args.purgeUser) {
    // Sessions + accounts cascade on user delete (onDelete: Cascade), as do the
    // reviewer's Friendship rows (FK onDelete: Cascade), so deleting the demo
    // friend users below also clears every seeded friendship.
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`Deleted reviewer user ${user.email} (${user.id}).`);

    const friends = await prisma.user.deleteMany({
      where: { email: { endsWith: `@${FRIEND_EMAIL_DOMAIN}` } },
    });
    console.log(`Deleted ${friends.count} demo friend user(s).`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.teardown) {
    await teardown(args);
    return;
  }

  if (args.armTermsOnly) {
    // Re-arm the one-time Terms acceptance gate for the EXISTING reviewer and
    // exit — the App Store screenshot run signs in and accepts the gate, so the
    // capture script calls this afterward to restore the submission-ready state.
    const existing = await prisma.user.findUnique({
      where: { email: args.email },
      select: { id: true },
    });
    if (!existing) {
      console.error(
        `--arm-terms-only: no user with email ${args.email} — run the full seed first.`,
      );
      process.exitCode = 1;
      return;
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: { termsAcceptedAt: null },
    });
    console.log(
      `Terms gate re-armed for ${args.email} — first sign-in shows the acceptance screen.`,
    );
    return;
  }

  const reviewer = await ensureReviewerUser(args);

  // One Gemini-key gate for the whole run — the reviewer's scene AND each demo
  // friend's scene use the same embedding model, so fail fast before any seeding
  // if it's needed but missing.
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
  }

  console.log(
    args.scene
      ? "\nSeeding reviewer content + categories/focus areas through the worker pipeline…"
      : "\nSeeding reviewer content…",
  );
  const items = await seedUserWorld(reviewer.userId, REVIEWER_CORPUS, {
    scene: args.scene,
    postLimit: args.posts,
  });

  let friendsOutcome: "seeded" | "skipped" | "disabled" = "disabled";
  if (args.friends) {
    console.log(
      `\nSeeding reviewer friends + their content via the live endpoints at ${args.webUrl}…`,
    );
    // ensureReviewerUser only surfaces a *generated* password (null when one was
    // supplied), but the account was set to args.password either way — so the
    // effective sign-in password is whichever is non-null.
    const signInPassword = reviewer.password ?? args.password ?? null;
    friendsOutcome = await seedFriends(
      { ...reviewer, password: signInPassword },
      args.webUrl,
      args.scene,
    );
  }

  if (args.resetTerms) {
    // Last step so nothing later re-stamps it. Demo friends keep their stamp —
    // they never sign in.
    await prisma.user.update({
      where: { id: reviewer.userId },
      data: { termsAcceptedAt: null },
    });
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
  console.log(
    `  Demo friends: ${
      friendsOutcome === "seeded"
        ? `${DEMO_FRIENDS.length} seeded via ${args.webUrl} (real friend-request flow), each with their own FRIENDS posts in the feed`
        : friendsOutcome === "skipped"
          ? "SKIPPED this run (see the warning above — existing friendships in the DB are untouched)"
          : "skipped (--no-friends)"
    }`,
  );
  console.log(
    `  Terms gate: ${args.resetTerms ? "armed — first sign-in shows the acceptance screen" : "kept (--keep-terms)"}`,
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
