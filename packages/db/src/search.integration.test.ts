import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GOLDEN_QUERIES } from "../test/fixtures/search-corpus";
import {
  RUN_DB,
  fixtureEmbedder,
  seedFixtures,
  throwingEmbedder,
  truncateAll,
  userId,
} from "../test/search-harness";
import { listVisiblePostEmbeddings } from "./embeddings";
import { friendIdsOf } from "./friends";
import { prisma } from "./index";
import { searchCorpus } from "./search";

const suite = RUN_DB ? describe : describe.skip;
if (!RUN_DB) {
  console.warn("[search.integration] TEST_DATABASE_URL unset — skipping DB integration suite.");
}

suite("searchCorpus integration (golden matrix)", () => {
  beforeAll(async () => {
    await seedFixtures();
  });
  afterAll(async () => {
    await truncateAll();
  });

  for (const g of GOLDEN_QUERIES) {
    test(g.name, async () => {
      const page = await searchCorpus(userId(g.viewerKey), g.query, {
        scope: g.scope,
        limit: 50,
        publicCatalogEnabled: g.publicCatalogEnabled,
        embedder: g.mode === "fts-only" ? throwingEmbedder : fixtureEmbedder,
      });
      const slugs = page.items.map((i) => i.slug);

      if (g.expectPartial !== undefined) {
        expect(page.partial).toBe(g.expectPartial);
      }
      for (const [above, below] of g.rankedAbove ?? []) {
        expect(slugs).toContain(above);
        expect(slugs).toContain(below);
        expect(slugs.indexOf(above)).toBeLessThan(slugs.indexOf(below));
      }
      for (const s of g.mustNotContain ?? []) {
        expect(slugs).not.toContain(s);
      }
      for (const s of g.mustContain ?? []) {
        expect(slugs).toContain(s);
      }
      if (g.orderedSubset) {
        const idx = g.orderedSubset.map((s) => slugs.indexOf(s));
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      }
      if (g.exactOrder) {
        expect(slugs).toEqual(g.exactOrder);
      }
      if (g.bothLegsAboveSingle) {
        const reasons = page.items.map((i) => i.matchReasons.length);
        // Fusion actually produced both kinds (otherwise the invariant is vacuous).
        expect(reasons).toContain(2);
        expect(reasons).toContain(1);
        // Every both-legs hit precedes every single-leg hit.
        const lastBoth = reasons.lastIndexOf(2);
        const firstSingle = reasons.indexOf(1);
        expect(lastBoth).toBeLessThan(firstSingle);
      }
    });
  }

  test("pagination is stable: page1 ∪ page2 == full, no dupes/gaps", async () => {
    const opts = { scope: "all" as const, embedder: throwingEmbedder };
    const full = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 50 });
    const fullSlugs = full.items.map((i) => i.slug);

    const p1 = await searchCorpus(userId("viewer"), "zephyrium", { ...opts, limit: 2 });
    const p2 = await searchCorpus(userId("viewer"), "zephyrium", {
      ...opts, limit: 2, cursor: p1.nextCursor ?? undefined,
    });
    const paged = [...p1.items, ...p2.items].map((i) => i.slug);

    expect(new Set(paged).size).toBe(paged.length); // no dupes
    expect(paged).toEqual(fullSlugs.slice(0, paged.length)); // same prefix order
  });

  // Regression: a viewer with >= 2 friends must not crash the full-text leg.
  // `= ANY(${array})` in prisma.$queryRaw expands the array into a positional
  // list (`ANY($6, $7)`) → Postgres 42601 "syntax error at or near \"$7\"".
  // The fixture viewer has exactly 1 friend, which is how the golden matrix
  // missed it — so this test adds a second accepted friendship inline.
  test("viewer with >=2 friends: full-text leg does not 42601 and friend posts stay visible", async () => {
    await prisma.user.create({
      data: {
        id: "user-second-friend",
        name: "Second Friend",
        email: "second-friend@example.test",
        emailVerified: true,
        handle: "second-friend",
      },
    });
    const [a, b] = [userId("viewer"), "user-second-friend"].sort();
    await prisma.friendship.create({
      data: { userAId: a, userBId: b, status: "ACCEPTED", requestedById: a, acceptedAt: new Date() },
    });

    // Crashes with 42601 before the Prisma.join fix; must resolve after.
    const page = await searchCorpus(userId("viewer"), "zephyrium", {
      scope: "all",
      limit: 50,
      embedder: throwingEmbedder,
    });
    const slugs = page.items.map((i) => i.slug);

    // Semantics preserved: the original friend's FRIENDS/PUBLISHED post is
    // still found, and the never-leak posts stay hidden.
    expect(slugs).toContain("friend-friends-pub");
    expect(slugs).not.toContain("stranger-private");
    expect(slugs).not.toContain("friend-friends-draft");
  });

  // --- Track 2: scope=friends security invariants --------------------------
  // These seed extra rows ON TOP of the base fixtures (viewer <-> friend are
  // ACCEPTED friends; stranger is unrelated) and clean up after themselves so
  // they don't perturb the golden-matrix cases above. Run FTS-only (throwing
  // embedder) unless a case explicitly exercises the embedding leg.
  const FRIEND = userId("friend");

  // Minimal post creator mirroring seedFixtures' required columns. All bodies
  // carry the "zephyrium" probe so a single query surfaces every seeded row.
  async function createFriendPost(input: {
    slug: string;
    ownerId: string;
    visibility: "PRIVATE" | "FRIENDS" | "GROUP" | "PUBLIC";
    status?: "PUBLISHED" | "DRAFT";
  }): Promise<string> {
    const status = input.status ?? "PUBLISHED";
    const row = await prisma.post.create({
      data: {
        slug: input.slug,
        title: `Track2 zephyrium ${input.slug}`,
        content: "zephyrium in the body",
        excerpt: "zephyrium summary",
        type: "BLOG",
        status,
        visibility: input.visibility,
        published: status === "PUBLISHED",
        filePath: `t2/${input.slug}.md`,
        fileHash: `t2-${input.slug}`,
        submittedById: input.ownerId,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    return row.id;
  }

  async function friendsSearch(publicCatalogEnabled = false): Promise<string[]> {
    const page = await searchCorpus(userId("viewer"), "zephyrium", {
      scope: "friends",
      limit: 50,
      publicCatalogEnabled,
      embedder: throwingEmbedder,
    });
    return page.items.map((i) => i.slug);
  }

  // (i) THE hard guarantee: a non-friend's PUBLIC post NEVER surfaces under
  // scope=friends, even with the public catalog ON — there is no unrestricted
  // PUBLIC arm in this scope, only a friend-author-gated one.
  test("scope=friends: non-friend PUBLIC never leaks even with publicCatalogEnabled=true", async () => {
    const slugs = await friendsSearch(true);
    expect(slugs).not.toContain("stranger-public");
    expect(slugs).not.toContain("stranger-private");
    // Friend's FRIENDS post + own draft DO appear; friend's DRAFT never does.
    expect(slugs).toContain("friend-friends-pub");
    expect(slugs).toContain("viewer-draft");
    expect(slugs).not.toContain("friend-friends-draft");
  });

  // (ii) A FRIEND's PUBLIC post DOES appear — admitted by friend authorship, not
  // by the public-catalog flag (here it's OFF).
  test("scope=friends: a FRIEND's PUBLIC post appears (author-gated, flag-independent)", async () => {
    await createFriendPost({ slug: "t2-friend-public", ownerId: FRIEND, visibility: "PUBLIC" });
    try {
      const slugs = await friendsSearch(false);
      expect(slugs).toContain("t2-friend-public");
      expect(slugs).not.toContain("stranger-public");
    } finally {
      await prisma.post.deleteMany({ where: { slug: "t2-friend-public" } });
    }
  });

  // (iii) Friend FRIENDS + member-GROUP appear; a GROUP post the viewer is NOT a
  // member of, and a friend PRIVATE post, do NOT.
  test("scope=friends: friend GROUP visible only to a member; friend PRIVATE never", async () => {
    const groupIn = await prisma.shareGroup.create({
      data: { ownerId: FRIEND, name: "t2-group-in" },
    });
    const groupOut = await prisma.shareGroup.create({
      data: { ownerId: FRIEND, name: "t2-group-out" },
    });
    await prisma.shareGroupMember.create({
      data: { groupId: groupIn.id, userId: userId("viewer") },
    });
    const memberPostId = await createFriendPost({ slug: "t2-group-in", ownerId: FRIEND, visibility: "GROUP" });
    const nonMemberPostId = await createFriendPost({ slug: "t2-group-out", ownerId: FRIEND, visibility: "GROUP" });
    await prisma.postShareGroup.create({ data: { postId: memberPostId, groupId: groupIn.id } });
    await prisma.postShareGroup.create({ data: { postId: nonMemberPostId, groupId: groupOut.id } });
    await createFriendPost({ slug: "t2-friend-private", ownerId: FRIEND, visibility: "PRIVATE" });
    try {
      const slugs = await friendsSearch(false);
      expect(slugs).toContain("t2-group-in");
      expect(slugs).not.toContain("t2-group-out");
      expect(slugs).not.toContain("t2-friend-private");
    } finally {
      await prisma.post.deleteMany({
        where: { slug: { in: ["t2-group-in", "t2-group-out", "t2-friend-private"] } },
      });
      await prisma.shareGroup.deleteMany({ where: { id: { in: [groupIn.id, groupOut.id] } } });
    }
  });

  // (iv) A blocked author is fully excluded — even a still-"friend" who is
  // blocked. We insert the UserBlock directly (keeping the friendship intact) to
  // isolate the blockedIds clamp from the block→unfriend cascade.
  test("scope=friends: a blocked user's posts never appear (block clamp)", async () => {
    await prisma.userBlock.create({
      data: { blockerId: userId("viewer"), blockedId: FRIEND },
    });
    try {
      const slugs = await friendsSearch(false);
      expect(slugs).not.toContain("friend-friends-pub");
      // The viewer's own posts survive the clamp.
      expect(slugs).toContain("viewer-draft");
    } finally {
      await prisma.userBlock.deleteMany({
        where: { blockerId: userId("viewer"), blockedId: FRIEND },
      });
    }
  });

  // (v) The FTS and embedding legs agree: neither surfaces a row the other gates
  // out. Fused mode (real snapshot embedder) — if EITHER leg leaked a non-friend
  // PUBLIC post, RRF's union would surface it, so its absence proves agreement.
  // A belt-and-braces check gates the embedding candidate set (the semantic leg's
  // input) directly with the same friends-scope predicate.
  test("scope=friends: FTS and embedding legs agree (no leg surfaces a gated row)", async () => {
    const page = await searchCorpus(userId("viewer"), "zephyrium", {
      scope: "friends",
      limit: 50,
      publicCatalogEnabled: true,
      embedder: fixtureEmbedder,
    });
    expect(page.partial).toBe(false); // embedding leg actually ran
    const slugs = page.items.map((i) => i.slug);
    expect(slugs).not.toContain("stranger-public");
    expect(slugs).toContain("friend-friends-pub");

    // The semantic leg's candidate set is gated by the identical predicate.
    const friendIds = await friendIdsOf(userId("viewer"));
    const candSlugs = (
      await listVisiblePostEmbeddings(
        userId("viewer"),
        friendIds,
        /* includePublic */ false,
        /* blockedIds */ [],
        /* includeOwn */ true,
        /* includeFriendPublic */ true,
      )
    ).map((c) => c.slug);
    expect(candSlugs).not.toContain("stranger-public");
    expect(candSlugs).toContain("friend-friends-pub");
  });
});
