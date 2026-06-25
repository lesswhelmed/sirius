import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../src/index";
import type { QueryEmbedder } from "../src/search";
import {
  FIXTURE_CATEGORIES,
  FIXTURE_POSTS,
  FIXTURE_TAGS,
  FIXTURE_USERS,
} from "./fixtures/search-corpus";

export const RUN_DB = !!process.env.TEST_DATABASE_URL;

interface Snapshot {
  meta: { modelTag: string; dimensionality: number };
  posts: Record<string, number[]>;
  queries: Record<string, number[]>;
}
const snapshot: Snapshot = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/search-embeddings.json"), "utf8"),
);

export function userId(key: "viewer" | "friend" | "stranger"): string {
  return FIXTURE_USERS.find((u) => u.key === key)!.id;
}

// Replays snapshot query vectors; throws on an unknown query so a missing
// snapshot fails loudly instead of silently degrading.
export const fixtureEmbedder: QueryEmbedder = async (query) => {
  const v = snapshot.queries[query];
  if (!v) throw new Error(`No snapshot embedding for query: ${JSON.stringify(query)}`);
  return v;
};

// Simulates Gemini being down (I9 degraded mode).
export const throwingEmbedder: QueryEmbedder = async () => {
  throw new Error("embedder unavailable (simulated)");
};

// Safety guard: refuses to run destructive operations unless DATABASE_URL
// is confirmed to be the test database. This prevents accidentally wiping
// the dev database when bun auto-loads .env and DATABASE_URL is not overridden.
function assertTestDb(): void {
  const url = process.env.DATABASE_URL ?? "";
  const test = process.env.TEST_DATABASE_URL ?? "";
  const ok = (test && url === test) || /[-_]test(\?|$)/.test(url);
  if (!ok) {
    throw new Error(
      "Refusing to seed/truncate: DATABASE_URL is not the test DB. " +
      "Run with DATABASE_URL=\"$TEST_DATABASE_URL\" (see db:test:setup).",
    );
  }
}

export async function truncateAll(): Promise<void> {
  assertTestDb();
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PostEmbedding", "_PostToTag", "_PostToCategory", "Post", "Tag", "Category", "friendship", "user" RESTART IDENTITY CASCADE`,
  );
}

export async function seedFixtures(): Promise<void> {
  assertTestDb();
  await truncateAll();

  for (const u of FIXTURE_USERS) {
    await prisma.user.create({
      data: { id: u.id, name: u.name, email: u.email, emailVerified: true, handle: u.handle },
    });
  }

  // viewer <-> friend are ACCEPTED friends (canonical ordered pair for the unique constraint).
  const [a, b] = [userId("viewer"), userId("friend")].sort();
  await prisma.friendship.create({
    data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: a, acceptedAt: new Date() },
  });

  for (const t of FIXTURE_TAGS) {
    await prisma.tag.create({ data: { name: t, slug: t } });
  }
  for (const c of FIXTURE_CATEGORIES) {
    await prisma.category.create({ data: { name: c.name, displayName: c.displayName, slug: c.name } });
  }

  for (const p of FIXTURE_POSTS) {
    await prisma.post.create({
      data: {
        slug: p.slug,
        title: p.title,
        content: p.content,
        excerpt: p.excerpt,
        type: p.type,
        status: p.status,
        visibility: p.visibility,
        published: p.status === "PUBLISHED",
        filePath: `fixtures/${p.slug}.md`,
        fileHash: `hash-${p.slug}`,
        submittedById: userId(p.ownerKey),
        createdAt: new Date(p.createdAtIso),
        tags: { connect: p.tags.map((name) => ({ name })) },
        categories: { connect: p.categories.map((name) => ({ name })) },
      },
    });
    const vec = snapshot.posts[p.slug];
    if (!vec) throw new Error(`No snapshot embedding for post: ${p.slug}`);
    await prisma.postEmbedding.create({
      data: {
        postId: (await prisma.post.findUniqueOrThrow({ where: { slug: p.slug }, select: { id: true } })).id,
        ownerId: userId(p.ownerKey),
        retrievalText: `${p.title} ${p.content}`,
        embedding: vec,
        embeddingHash: `hash-${p.slug}`,
        modelVersion: snapshot.meta.modelTag,
        dimensionality: snapshot.meta.dimensionality,
      },
    });
  }
}
